// Tools that need the Mac itself: safari_upload_file (reads the files) and safari_save_pdf (writes one).
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let MAX_UPLOAD = 20 << 20

func expandPath(_ s: String) -> String {
    if s == "~" { return home.path }
    if s.hasPrefix("~/") { return home.path + String(s.dropFirst(1)) }
    return s
}

/// Folders and names that hold credentials: never uploaded, never written to.
let PROTECTED_DIRS = [".ssh", ".gnupg", ".aws", ".kube", ".docker", ".claude-in-safari", ".config", "Library/Keychains", "Library/Cookies",
                      "Library/Safari", "Library/Mail", "Library/Messages", "Library/Application Support"]
func isProtected(_ path: String) -> Bool {
    let base = home.resolvingSymlinksInPath().path + "/"
    let p = URL(fileURLWithPath: path).resolvingSymlinksInPath().path
    if p.hasPrefix(base) {
        let rel = String(p.dropFirst(base.count))
        if PROTECTED_DIRS.contains(where: { rel == $0 || rel.hasPrefix($0 + "/") }) { return true }
    }
    let name = (p as NSString).lastPathComponent.lowercased()
    return name.hasPrefix("id_rsa") || name.hasPrefix("id_ed25519") || name.hasPrefix("id_ecdsa") || name.hasSuffix(".pem") || name.hasSuffix(".p12") || name == ".env" || name.hasSuffix(".keychain-db")
}

/// Turns the paths of safari_upload_file into file contents for the extension. Other tools pass through unchanged.
func prepareArgs(_ method: String, _ args: [String: Any], _ done: @escaping (Result<[String: Any], MsgError>) -> Void) {
    guard method == "upload_file" else { return done(.success(args)) }
    guard let paths = args["paths"] as? [String], !paths.isEmpty else { return done(.failure(MsgError(message: "paths is required"))) }
    var files: [[String: Any]] = []
    for raw in paths {
        let path = expandPath(raw)
        guard path.hasPrefix("/") else { return done(.failure(MsgError(message: "Use absolute paths: \(raw)"))) }
        if isProtected(path) { return done(.failure(MsgError(message: "Refused: \(raw) is in a protected location (keys, credentials, app data)."))) }
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: path, isDirectory: &isDir), !isDir.boolValue else { return done(.failure(MsgError(message: "Not a file: \(raw)"))) }
        let size = ((try? FileManager.default.attributesOfItem(atPath: path))?[.size] as? Int) ?? 0
        if size > MAX_UPLOAD { return done(.failure(MsgError(message: "\(raw) is \(size >> 20) MB; the limit is \(MAX_UPLOAD >> 20) MB per file."))) }
        guard let d = FileManager.default.contents(atPath: path) else { return done(.failure(MsgError(message: "Cannot read \(raw)"))) }
        let ext = (path as NSString).pathExtension
        let mime = UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
        files.append(["name": (path as NSString).lastPathComponent, "mime": mime, "data": d.base64EncodedString()])
    }
    var a = args
    a.removeValue(forKey: "paths")
    a["files"] = files
    done(.success(a))
}

/// A4 pages from one tall image: the picture is scaled to the page width and cut into page-high slices.
func buildPDF(from jpeg: Data) -> Data? {
    guard let src = CGImageSourceCreateWithData(jpeg as CFData, nil), let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { return nil }
    let pw: CGFloat = 595, ph: CGFloat = 842
    let scale = pw / CGFloat(img.width)
    let slice = Int((ph / scale).rounded(.down))
    let out = NSMutableData()
    var box = CGRect(x: 0, y: 0, width: pw, height: ph)
    guard let consumer = CGDataConsumer(data: out), let ctx = CGContext(consumer: consumer, mediaBox: &box, nil) else { return nil }
    var y = 0
    while y < img.height {
        let h = min(slice, img.height - y)
        guard let part = img.cropping(to: CGRect(x: 0, y: y, width: img.width, height: h)) else { return nil }
        ctx.beginPDFPage(nil)
        ctx.setFillColor(CGColor(gray: 1, alpha: 1)); ctx.fill(box)
        let dh = CGFloat(h) * scale
        ctx.draw(part, in: CGRect(x: 0, y: ph - dh, width: pw, height: dh))
        ctx.endPDFPage()
        y += h
    }
    ctx.closePDF()
    return out as Data
}

func safeFileName(_ s: String) -> String {
    let bad = CharacterSet(charactersIn: "/\\:*?\"<>|\n\r\t").union(.controlCharacters)
    let t = s.components(separatedBy: bad).joined(separator: " ").trimmingCharacters(in: .whitespaces.union(CharacterSet(charactersIn: ".")))
    return String((t.isEmpty ? "page" : t).prefix(80))
}

func uniqueURL(_ u: URL) -> URL {
    var n = 1, cur = u
    while FileManager.default.fileExists(atPath: cur.path) {
        n += 1
        cur = u.deletingLastPathComponent().appendingPathComponent(u.deletingPathExtension().lastPathComponent + " \(n)." + u.pathExtension)
    }
    return cur
}

/// safari_save_pdf: whole-page screenshot -> PDF file under the home folder. Never overwrites, never writes into protected places.
func savePDF(_ args: [String: Any], _ done: @escaping ([String: Any]) -> Void) {
    func fail(_ m: String) { done(textResult(m, error: true)) }
    var tabArgs: [String: Any] = [:]
    if let t = args["tabId"] { tabArgs["tabId"] = t }
    call("tab_info", tabArgs) { ti in
        let title = ((try? ti.get()) as? [String: Any])?["title"] as? String ?? "page"
        var shot = tabArgs
        if let mh = args["maxHeight"] { shot["maxHeight"] = mh }
        call("fullshot", shot, timeout: 120) { res in
            switch res {
            case .failure(let e): fail((e as? MsgError)?.message ?? "\(e)")
            case .success(let v):
                guard let d = (v as? [String: Any])?["dataUrl"] as? String, let r = d.range(of: ";base64,"),
                      let jpeg = Data(base64Encoded: String(d[r.upperBound...])), let pdf = buildPDF(from: jpeg) else { return fail("Could not build the PDF from the screenshot.") }
                var target: URL
                if let p = args["path"] as? String, !p.isEmpty {
                    let full = expandPath(p)
                    guard full.hasPrefix("/") else { return fail("Use an absolute path (or ~/...).") }
                    target = URL(fileURLWithPath: full).standardizedFileURL
                    if target.pathExtension.lowercased() != "pdf" { target.appendPathExtension("pdf") }
                } else {
                    target = home.appendingPathComponent("Downloads/" + safeFileName(title) + ".pdf")
                }
                let base = home.standardizedFileURL.path + "/"
                guard target.path.hasPrefix(base), !isProtected(target.path), !target.path.dropFirst(base.count).hasPrefix("Library/") else {
                    return fail("Refused: PDFs are saved inside your home folder, outside system and credential folders.")
                }
                let url = uniqueURL(target)
                do {
                    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                    try pdf.write(to: url, options: .withoutOverwriting)
                } catch { return fail("Cannot write \(url.path): \(error.localizedDescription)") }
                let o = v as? [String: Any]
                done(textResult(["saved": url.path, "bytes": pdf.count, "pages": o?["pages"] ?? NSNull(), "note": "image-based PDF (text is not selectable)"] as [String: Any]))
            }
        }
    }
}
