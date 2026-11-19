// Claude Safari Server: MCP over stdio for Claude, WebSocket on 127.0.0.1 for the Safari extension.
// Same behaviour as server/server.js (the Node reference): several instances may run at once; the first owns the port
// ("hub") and talks to the extension, the others join it as clients and relay calls.
import Foundation
import Network
import CryptoKit
import Security

let SERVER_VERSION = "1.0.3"
let port = UInt16(ProcessInfo.processInfo.environment["SAFARI_CLAUDE_PORT"] ?? "") ?? 18765
let NOT_CONNECTED = "Safari extension is not connected. Open Safari and enable 'Claude for Safari' (Safari > Settings > Extensions)."
let Q = DispatchQueue(label: "claude-safari-server")
func log(_ s: String) { FileHandle.standardError.write(Data(("[safari-claude] " + s + "\n").utf8)) }
let home = URL(fileURLWithPath: ProcessInfo.processInfo.environment["HOME"] ?? NSHomeDirectory())
func jsonData(_ o: Any, pretty: Bool = false) -> Data {
    (try? JSONSerialization.data(withJSONObject: o, options: pretty ? [.prettyPrinted, .withoutEscapingSlashes, .fragmentsAllowed] : [.withoutEscapingSlashes, .fragmentsAllowed])) ?? Data("null".utf8)
}
func parse(_ d: Data) -> [String: Any]? { (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] }

// `claude-safari-server --install` adds this server to Claude Desktop's config (keeps a .bak copy).
if CommandLine.arguments.contains("--install") {
    let file = home.appendingPathComponent("Library/Application Support/Claude/claude_desktop_config.json")
    var cfg: [String: Any] = [:]
    if let d = try? Data(contentsOf: file) {
        try? d.write(to: file.appendingPathExtension("bak"))
        guard let c = parse(d) else { print("Cannot parse \(file.path): fix it by hand, nothing changed."); exit(1) }
        cfg = c
    }
    var servers = cfg["mcpServers"] as? [String: Any] ?? [:]
    servers["Claude in Safari"] = ["command": URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL.path, "args": [String]()]
    cfg["mcpServers"] = servers
    try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
    try jsonData(cfg, pretty: true).write(to: file)
    print("added to " + file.path); exit(0)
}

// `claude-safari-server --policy` creates ~/.claude-in-safari/policy.json if missing and prints where it is and what it says.
if CommandLine.arguments.contains("--policy") {
    ensurePolicyFile()
    let (pol, err) = loadPolicy()
    print("policy file: " + policyURL.path)
    if let e = err { print("PROBLEM: " + e) } else { print("blocked: \(pol.blocked)\nconfirm: \(pol.confirm)\nconfirmAll: \(pol.confirmAll)") }
    exit(err == nil ? 0 : 1)
}

// Access control: a browser always sends Origin, so only the extension's own origin is accepted from one; other local clients
// (MCP instances) must present the secret from ~/.claude-in-safari/token.
// shortcut: a local process of the same user can read the token or fake the extension origin, that is out of scope here.
let tokenURL = home.appendingPathComponent(".claude-in-safari/token")
let TOKEN: String = {
    let fm = FileManager.default
    try? fm.createDirectory(at: tokenURL.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    if !fm.fileExists(atPath: tokenURL.path) {
        var b = [UInt8](repeating: 0, count: 24); _ = SecRandomCopyBytes(kSecRandomDefault, 24, &b)
        fm.createFile(atPath: tokenURL.path, contents: Data(b.map { String(format: "%02x", $0) }.joined().utf8), attributes: [.posixPermissions: 0o600])
    }
    return ((try? String(contentsOf: tokenURL, encoding: .utf8)) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
}()

struct MsgError: Error { let message: String }
var mode: String? = nil // "hub" | "client"
var ext: Peer? = nil // hub: the extension socket that gets commands (the most recent one)
var exts: [Peer] = [] // hub: every connected extension page
var hubTask: URLSessionWebSocketTask? = nil // client: socket to the hub
var seq = 0
var pending: [Int: (Result<Any?, Error>) -> Void] = [:] // calls made by this instance
var routes: [Int: (peer: Peer, id: Any)] = [:] // hub: relayed client calls, hub id -> client

func waitUntil(_ cond: @escaping () -> Bool, ms: Int, _ k: @escaping (Bool) -> Void, _ t: Int = 0) {
    if cond() { return k(true) }
    if t >= ms { return k(false) }
    Q.asyncAfter(deadline: .now() + .milliseconds(200)) { waitUntil(cond, ms: ms, k, t + 200) }
}
func extUp() -> Bool { ext != nil && !(ext!.closed) }

func settle(_ m: [String: Any]) -> Bool {
    guard let id = m["id"] as? Int, let k = pending.removeValue(forKey: id) else { return false }
    if let e = m["error"] { k(.failure(MsgError(message: (e as? String) ?? "\(e)")))} else { k(.success(m["result"])) }
    return true
}

// ---- hub: a tiny WebSocket server (RFC 6455) over TCP ----
final class Peer {
    let conn: NWConnection
    var buf = Data(), frag = Data()
    var upgraded = false, viaExt = false, closed = false
    init(_ c: NWConnection) { conn = c }
    func send(_ payload: Data, op: UInt8 = 0x1) {
        var h = Data([0x80 | op]); let n = payload.count
        if n < 126 { h.append(UInt8(n)) }
        else if n < 65536 { h += [126, UInt8(n >> 8), UInt8(n & 0xff)] }
        else { h.append(127); for i in (0..<8).reversed() { h.append(UInt8((UInt64(n) >> UInt64(i * 8)) & 0xff)) } }
        conn.send(content: h + payload, completion: .contentProcessed { _ in })
    }
    func sendJSON(_ o: Any) { send(jsonData(o)) }
    func close() { if !closed { closed = true; conn.cancel() } }
}

func peerClosed(_ p: Peer) {
    p.closed = true
    exts.removeAll { $0 === p }
    if ext === p { ext = exts.last }
}

func reject(_ p: Peer, _ why: String) {
    log("rejected connection, " + why)
    p.conn.send(content: Data("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".utf8), completion: .contentProcessed { _ in p.close() })
    p.closed = true
}

func process(_ p: Peer) {
    if !p.upgraded {
        guard let r = p.buf.range(of: Data("\r\n\r\n".utf8)) else { return }
        var lines = String(decoding: p.buf[..<r.lowerBound], as: UTF8.self).components(separatedBy: "\r\n")
        p.buf = Data(p.buf[r.upperBound...])
        let reqLine = lines.removeFirst()
        var h: [String: String] = [:]
        for l in lines { if let i = l.firstIndex(of: ":") { h[l[..<i].lowercased()] = l[l.index(after: i)...].trimmingCharacters(in: .whitespaces) } }
        let target = reqLine.split(separator: " ").dropFirst().first.map(String.init) ?? "/"
        let token = URLComponents(string: "http://x" + target)?.queryItems?.first { $0.name == "t" }?.value
        let origin = h["origin"]
        p.viaExt = origin?.hasPrefix("safari-web-extension://") ?? false
        guard (origin != nil ? p.viaExt : token == TOKEN), h["upgrade"]?.lowercased() == "websocket", let key = h["sec-websocket-key"] else {
            return reject(p, "origin=" + (origin ?? "none"))
        }
        let accept = Data(Insecure.SHA1.hash(data: Data((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").utf8))).base64EncodedString()
        p.upgraded = true
        p.conn.send(content: Data("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: \(accept)\r\n\r\n".utf8), completion: .contentProcessed { _ in })
    }
    while !p.closed {
        let n = p.buf.count
        if n < 2 { return }
        let b0 = p.buf[p.buf.startIndex], b1 = p.buf[p.buf.startIndex + 1]
        let fin = b0 & 0x80 != 0, op = b0 & 0x0f, masked = b1 & 0x80 != 0
        var len = Int(b1 & 0x7f), off = 2
        if len == 126 { if n < 4 { return }; len = Int(p.buf[p.buf.startIndex + 2]) << 8 | Int(p.buf[p.buf.startIndex + 3]); off = 4 }
        else if len == 127 { if n < 10 { return }; len = 0; for i in 2..<10 { len = len << 8 | Int(p.buf[p.buf.startIndex + i]) }; off = 10 }
        let mlen = masked ? 4 : 0
        if n < off + mlen + len { return }
        var payload = Data(p.buf[(p.buf.startIndex + off + mlen)..<(p.buf.startIndex + off + mlen + len)])
        if masked {
            let mk = Array(p.buf[(p.buf.startIndex + off)..<(p.buf.startIndex + off + 4)])
            payload.withUnsafeMutableBytes { (raw: UnsafeMutableRawBufferPointer) in for i in 0..<raw.count { raw[i] ^= mk[i & 3] } }
        }
        p.buf = Data(p.buf[(p.buf.startIndex + off + mlen + len)...])
        switch op {
        case 0x8: p.close(); peerClosed(p); return
        case 0x9: p.send(payload, op: 0xA)
        case 0x0, 0x1:
            p.frag.append(payload)
            if fin { let m = p.frag; p.frag = Data(); if let o = parse(m) { onMessage(p, o) } }
        default: break
        }
    }
}

func onMessage(_ p: Peer, _ m: [String: Any]) {
    if m["hello"] as? String == "safari" {
        if !p.viaExt { return p.close() }
        if !exts.contains(where: { $0 === p }) { exts.append(p) }
        ext = p
        return log("Safari extension connected (\(exts.count) page(s))")
    }
    if m["ping"] != nil { return p.sendJSON(["ping": 1]) }
    if m["method"] != nil && !p.viaExt { // request relayed from a client instance
        let cid = m["id"] ?? NSNull()
        waitUntil(extUp, ms: 6000) { up in
            if !up { if !p.closed { p.sendJSON(["id": cid, "error": NOT_CONNECTED]) }; return }
            seq += 1; routes[seq] = (p, cid)
            ext!.sendJSON(["id": seq, "method": m["method"]!, "params": m["params"] ?? [String: Any]()])
        }
        return
    }
    if p === ext { // response from the extension
        if let gid = m["id"] as? Int, let r = routes.removeValue(forKey: gid) {
            var out = m; out["id"] = r.id
            if !r.peer.closed { r.peer.sendJSON(out) }
        } else { _ = settle(m) }
    }
}

func receive(_ p: Peer) {
    p.conn.receive(minimumIncompleteLength: 1, maximumLength: 1 << 20) { data, _, done, err in
        if let d = data, !d.isEmpty { p.buf.append(d); process(p) }
        if done || err != nil { peerClosed(p); p.conn.cancel(); return }
        if !p.closed { receive(p) }
    }
}

func startHub() {
    let params = NWParameters.tcp
    params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!)
    let l: NWListener
    do { l = try NWListener(using: params) } catch { log("cannot listen: \(error)"); return joinHub() }
    l.stateUpdateHandler = { s in
        switch s {
        case .ready: mode = "hub"; log("hub listening on 127.0.0.1:\(port)")
        case .failed(let e): log("listener failed: \(e)"); l.cancel(); joinHub()
        case .waiting(let e): log("listener waiting: \(e)")
        default: break
        }
    }
    l.newConnectionHandler = { c in
        let p = Peer(c)
        c.stateUpdateHandler = { s in if case .failed = s { peerClosed(p) } }
        c.start(queue: Q)
        receive(p)
    }
    l.start(queue: Q)
}

// ---- client: another instance already owns the port ----
final class HubDelegate: NSObject, URLSessionWebSocketDelegate {
    func urlSession(_ s: URLSession, webSocketTask t: URLSessionWebSocketTask, didOpenWithProtocol p: String?) {
        Q.async { hubTask = t; log("joined hub as client") }
    }
}
let hubDelegate = HubDelegate()
func joinHub() {
    mode = "client"
    let t = URLSession(configuration: .ephemeral, delegate: hubDelegate, delegateQueue: nil)
        .webSocketTask(with: URL(string: "ws://127.0.0.1:\(port)/?t=\(TOKEN)")!)
    t.maximumMessageSize = 128 << 20
    t.resume()
    func recv() {
        t.receive { res in
            Q.async {
                switch res {
                case .failure: // hub gone: try to become the hub
                    hubTask = nil
                    Q.asyncAfter(deadline: .now() + .milliseconds(300 + Int.random(in: 0..<700))) { startHub() }
                case .success(let m):
                    if case .string(let s) = m, let o = parse(Data(s.utf8)) { _ = settle(o) }
                    recv()
                }
            }
        }
    }
    recv()
}

func call(_ method: String, _ params: Any, timeout: Double = 45, _ done: @escaping (Result<Any?, Error>) -> Void) {
    waitUntil({ mode != nil }, ms: 2000) { _ in
        let isHub = mode == "hub"
        waitUntil(isHub ? extUp : { hubTask != nil }, ms: isHub ? 6000 : 3000) { up in
            if !up { return done(.failure(MsgError(message: isHub ? NOT_CONNECTED : "Safari bridge is starting, retry in a moment."))) }
            seq += 1; let id = seq
            pending[id] = done
            Q.asyncAfter(deadline: .now() + timeout) { if let k = pending.removeValue(forKey: id) { k(.failure(MsgError(message: "Timed out: " + method))) } }
            let msg: [String: Any] = ["id": id, "method": method, "params": params]
            if isHub { ext!.sendJSON(msg) } else { hubTask!.send(.string(String(decoding: jsonData(msg), as: UTF8.self))) { _ in } }
        }
    }
}

// ---- MCP over stdio (newline-delimited JSON-RPC) ----
let tools = (try? JSONSerialization.jsonObject(with: Data(toolsJSON.utf8))) as? [[String: Any]] ?? []
func reply(_ id: Any, result: Any? = nil, error: (Int, String)? = nil) {
    var o: [String: Any] = ["jsonrpc": "2.0", "id": id]
    if let e = error { o["error"] = ["code": e.0, "message": e.1] } else { o["result"] = result ?? [String: Any]() }
    FileHandle.standardOutput.write(jsonData(o) + Data("\n".utf8))
}
func textResult(_ v: Any?, error: Bool = false) -> [String: Any] {
    let s: String
    if v == nil { s = "ok (no data returned)" }
    else if let t = v as? String { s = t }
    else { s = String(decoding: jsonData(v!, pretty: true), as: UTF8.self) }
    var r: [String: Any] = ["content": [["type": "text", "text": s]]]
    if error { r["isError"] = true }
    return r
}

func handle(_ line: String) {
    guard let o = parse(Data(line.utf8)), let method = o["method"] as? String, let id = o["id"] else { return } // notifications need no reply
    let params = o["params"] as? [String: Any] ?? [:]
    switch method {
    case "initialize":
        reply(id, result: ["protocolVersion": params["protocolVersion"] as? String ?? "2025-03-26", "capabilities": ["tools": [String: Any]()], "serverInfo": ["name": "Claude in Safari", "version": SERVER_VERSION]])
    case "ping": reply(id)
    case "tools/list": reply(id, result: ["tools": tools])
    case "tools/call":
        let name = params["name"] as? String ?? ""
        guard let m = methodFor[name] else { return reply(id, result: textResult("Unknown tool: " + name, error: true)) }
        policyCheck(name, params["arguments"] as? [String: Any] ?? [:]) { verdict in
            if case .deny(let why) = verdict { return reply(id, result: textResult(why, error: true)) }
            call(m, params["arguments"] ?? [String: Any](), timeout: m == "fullshot" ? 120 : 45) { res in
                switch res {
                case .failure(let e): reply(id, result: textResult((e as? MsgError)?.message ?? "\(e)", error: true))
                case .success(let raw):
                    let v = policyFilter(name, raw)
                    if (m == "screenshot" || m == "fullshot"), let d = (v as? [String: Any])?["dataUrl"] as? String,
                       let r = d.range(of: ";base64,"), d.hasPrefix("data:") {
                        reply(id, result: ["content": [["type": "image", "data": String(d[r.upperBound...]), "mimeType": String(d[d.index(d.startIndex, offsetBy: 5)..<r.lowerBound])]]])
                    } else { reply(id, result: textResult(v is NSNull ? "null" : v)) }
                }
            }
        }
    default: reply(id, error: (-32601, "Method not found: " + method))
    }
}

startHub()
Thread {
    while let line = readLine(strippingNewline: true) { Q.async { handle(line) } }
    exit(0)
}.start()
log("MCP server ready")
dispatchMain()
