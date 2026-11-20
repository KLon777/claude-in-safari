// Site policy for Claude in Safari (read from ~/.claude-in-safari/policy.json on every tool call, so edits apply at once).
//   "blocked":    hosts Claude may not touch at all: every tool on such a tab is refused, new_tab/navigate to it is refused,
//                 and safari_tabs shows those tabs without title and URL.
//   "confirm":    hosts where acting tools (click, type, key, form_input, eval, eval_page, navigate, new_tab, history) first ask
//                 you in a macOS dialog.
//   "confirmAll": the same question for every site.
//   "allowSensitive": hosts where cookies, storage and file upload (always asked about, even with no policy at all) go ahead
//                 without the question. Empty by default.
// A pattern "example.com" (or "*.example.com") matches the host and all of its subdomains; "*" matches everything.
// Pages without a host are matched by scheme: "file:", "favorites:", "about:".
// Limits: the check uses the tab's host at call time (a page can still redirect afterwards; navigate results are re-checked),
// and iframes from other hosts inside an allowed page are not inspected.
import Foundation

let policyURL = URL(fileURLWithPath: ProcessInfo.processInfo.environment["HOME"] ?? NSHomeDirectory())
    .appendingPathComponent(".claude-in-safari/policy.json")

struct Policy {
    var blocked: [String] = []
    var confirm: [String] = []
    var confirmAll = false
    var allowSensitive: [String] = []
    var isEmpty: Bool { blocked.isEmpty && confirm.isEmpty && !confirmAll }
}

let defaultPolicyText = """
{
  "_help": "blocked: Claude cannot use these sites at all. confirm: Claude asks you before acting there. confirmAll: ask on every site. allowSensitive: sites where cookies/storage/file upload need no question (otherwise they are always asked). 'example.com' also matches subdomains. Changes apply immediately.",
  "blocked": [],
  "confirm": [],
  "confirmAll": false,
  "allowSensitive": []
}

"""

func ensurePolicyFile() {
    let fm = FileManager.default
    try? fm.createDirectory(at: policyURL.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    if !fm.fileExists(atPath: policyURL.path) {
        fm.createFile(atPath: policyURL.path, contents: Data(defaultPolicyText.utf8), attributes: [.posixPermissions: 0o600])
    }
}

/// Fail closed: a policy file that exists but cannot be parsed blocks everything until it is fixed.
func loadPolicy() -> (Policy, String?) {
    ensurePolicyFile()
    guard let d = try? Data(contentsOf: policyURL) else { return (Policy(), nil) }
    guard let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else {
        return (Policy(), "policy.json is not valid JSON (\(policyURL.path)): fix it or delete it. Until then every tool is refused.")
    }
    func list(_ k: String) -> [String] { (o[k] as? [Any] ?? []).compactMap { ($0 as? String)?.lowercased().trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty } }
    return (Policy(blocked: list("blocked"), confirm: list("confirm"), confirmAll: o["confirmAll"] as? Bool ?? false, allowSensitive: list("allowSensitive")), nil)
}

func hostOf(_ url: String?) -> String {
    guard let u = url, let parsed = URL(string: u) else { return "" }
    if let h = parsed.host, !h.isEmpty { return h.lowercased() }
    // No host (file:///…, favorites://, about:blank): the scheme with a colon is the key, so "file:" or "*" can match it.
    if let sc = parsed.scheme, !sc.isEmpty { return sc.lowercased() + ":" }
    return ""
}

func hostMatches(_ host: String, _ pattern: String) -> Bool {
    if host.isEmpty { return false }
    if pattern == "*" { return true }
    let p = pattern.hasPrefix("*.") ? String(pattern.dropFirst(2)) : pattern
    return host == p || host.hasSuffix("." + p)
}

func isBlocked(_ host: String, _ p: Policy) -> Bool { p.blocked.contains { hostMatches(host, $0) } }

let ACTING: Set<String> = ["safari_click", "safari_type", "safari_key", "safari_form_input", "safari_eval", "safari_eval_page",
                           "safari_navigate", "safari_new_tab", "safari_history", "safari_dialog", "safari_drag"]
/// Tools that read or write credentials/files: they ask on every call (even with an empty policy) unless the site is in "allowSensitive"
/// or was approved "until restart".
let SENSITIVE: Set<String> = ["safari_cookies", "safari_storage", "safari_upload_file"]
var approvedHosts = Set<String>() // "allow this site until restart" answers; touched on Q only
var approvedSensitive = Set<String>() // the same for SENSITIVE tools

enum Verdict { case allow, deny(String) }

func describe(_ name: String, _ a: [String: Any]) -> String {
    func cut(_ s: String, _ n: Int) -> String { s.count > n ? String(s.prefix(n)) + "…" : s }
    var parts = [name.replacingOccurrences(of: "safari_", with: "")]
    if let u = a["url"] as? String { parts.append(cut(u, 80)) }
    if let t = a["text"] as? String { parts.append("«" + cut(t, 40) + "»") }
    if let v = a["value"] as? String { parts.append("«" + cut(v, 40) + "»") }
    if let c = a["code"] as? String { parts.append(cut(c.replacingOccurrences(of: "\n", with: " "), 80)) }
    if let k = a["key"] as? String { parts.append(k) }
    if let x = a["action"] as? String { parts.append(x) }
    if let n = a["name"] as? String { parts.append(cut(n, 40)) }
    if let x = a["area"] as? String { parts.append(x) }
    if let ps = a["paths"] as? [String] { parts.append(cut(ps.joined(separator: ", "), 120)) }
    return parts.joined(separator: " ")
}

/// Asks in a macOS dialog; osascript runs off the server queue. Any failure or timeout means "deny".
func askUser(host: String, action: String, _ k: @escaping (String) -> Void) {
    // Test hook (tools/policy_test.py): CIS_CONFIRM_ANSWER=deny|once|site answers without a dialog.
    if let a = ProcessInfo.processInfo.environment["CIS_CONFIRM_ANSWER"], ["deny", "once", "site"].contains(a) { return Q.async { k(a) } }
    func clean(_ s: String) -> String { String(String.UnicodeScalarView(s.unicodeScalars.filter { $0.value >= 32 && $0 != "\"" && $0 != "\\" })) }
    // The dialog speaks the language of the system (CIS_LANG=ru|en overrides it), like the wizard in the matching disk image.
    let lang = ProcessInfo.processInfo.environment["CIS_LANG"] ?? (Locale.preferredLanguages.first ?? "en")
    let ru = lang.lowercased().hasPrefix("ru")
    let text = ru ? "Claude хочет выполнить на «\(clean(host))»:\\n\(clean(action))" : "Claude wants to do this on \(clean(host)):\\n\(clean(action))"
    let deny = ru ? "Запретить" : "Deny", allow = ru ? "Разрешить" : "Allow", site = ru ? "Этот сайт до перезапуска" : "This site until restart"
    let script = "tell application \"System Events\"\nactivate\ndisplay dialog \"\(text)\" with title \"Claude in Safari\" buttons {\"\(deny)\", \"\(allow)\", \"\(site)\"} default button \"\(deny)\" cancel button \"\(deny)\" with icon caution giving up after 90\nend tell"
    DispatchQueue.global().async {
        let p = Process(); p.executableURL = URL(fileURLWithPath: "/usr/bin/osascript"); p.arguments = ["-e", script]
        let out = Pipe(); p.standardOutput = out; p.standardError = Pipe()
        var answer = "deny"
        do {
            try p.run()
            let s = String(decoding: out.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
            p.waitUntilExit()
            if p.terminationStatus == 0 && !s.contains("gave up:true") {
                if s.contains("button returned:" + site) { answer = "site" } else if s.contains("button returned:" + allow) { answer = "once" }
            }
        } catch { answer = "deny" }
        Q.async { k(answer) }
    }
}

/// Decides before a tool call is forwarded. `call` is the bridge call from main.swift.
func policyCheck(_ name: String, _ args: [String: Any], _ done: @escaping (Verdict) -> Void) {
    let (pol, err) = loadPolicy()
    if let e = err { return done(.deny(e)) }
    if name == "safari_tabs" || (pol.isEmpty && !SENSITIVE.contains(name)) { return done(.allow) }
    var hosts: [String] = []
    if let u = args["url"] as? String { hosts.append(hostOf(u)) }
    func decide(_ tabHost: String?) {
        if let t = tabHost { hosts.append(t) }
        if let h = hosts.first(where: { isBlocked($0, pol) }) {
            return done(.deny("Blocked by policy: \(h) is in the blocked list (\(policyURL.path)). Nothing was done."))
        }
        if SENSITIVE.contains(name) {
            let need = hosts.filter { h in !approvedSensitive.contains(h) && !pol.allowSensitive.contains { hostMatches(h, $0) } }
            let unknownS = hosts.allSatisfy { $0.isEmpty }
            guard let hostS = need.first ?? (unknownS ? "(unknown site)" : nil) else { return done(.allow) }
            return askUser(host: hostS, action: describe(name, args)) { ans in
                switch ans {
                case "site": approvedSensitive.formUnion(need); done(.allow)
                case "once": done(.allow)
                default: done(.deny("Refused by the user (confirmation dialog for \(hostS)). Nothing was done."))
                }
            }
        }
        guard ACTING.contains(name) else { return done(.allow) }
        let ask = hosts.filter { h in !approvedHosts.contains(h) && (pol.confirmAll || pol.confirm.contains { hostMatches(h, $0) }) }
        let unknown = pol.confirmAll && hosts.allSatisfy { $0.isEmpty }
        guard let host = ask.first ?? (unknown ? "(unknown site)" : nil) else { return done(.allow) }
        askUser(host: host, action: describe(name, args)) { ans in
            switch ans {
            case "site": approvedHosts.formUnion(ask); done(.allow)
            case "once": done(.allow)
            default: done(.deny("Refused by the user (confirmation dialog for \(host)). Nothing was done."))
            }
        }
    }
    if name == "safari_new_tab" { return decide(nil) }
    var p: [String: Any] = [:]
    if let t = args["tabId"] { p["tabId"] = t }
    call("tab_info", p) { res in
        switch res {
        case .success(let v):
            // Safari hides url/title of tabs on sites set to "Deny" in its own settings; such a tab cannot be checked, so refuse it.
            // Pages that have an address without a host (favorites://, about:blank) are fine.
            let u = ((v as? [String: Any])?["url"] as? String) ?? ""
            if u.isEmpty { return done(.deny("Policy is active and this tab's address is hidden by Safari (the site is set to Deny in the extension's website settings, or the tab is still loading). Nothing was done.")) }
            decide(hostOf(u))
        case .failure(let e): done(.deny("Policy is active but the tab could not be checked (\((e as? MsgError)?.message ?? "\(e)")). Update the Safari extension to the same version as the server."))
        }
    }
}

/// Hides what must not leave: titles/URLs of blocked tabs in safari_tabs, and a navigate result that ended on a blocked host.
func policyFilter(_ name: String, _ value: Any?) -> Any? {
    let (pol, err) = loadPolicy()
    if err != nil || pol.blocked.isEmpty { return value }
    if name == "safari_tabs", let tabs = value as? [[String: Any]] {
        return tabs.map { t in
            guard isBlocked(hostOf(t["url"] as? String), pol) else { return t }
            var r = t; r["url"] = "[blocked by policy]"; r["title"] = "[blocked by policy]"; return r
        }
    }
    if name == "safari_navigate" || name == "safari_new_tab", let o = value as? [String: Any], isBlocked(hostOf(o["url"] as? String), pol) {
        return "Blocked by policy: the page ended on a blocked site (\(hostOf(o["url"] as? String))). Its content was discarded."
    }
    return value
}
