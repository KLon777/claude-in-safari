// Draws the DMG window background: swift tools/dmg/background.swift OUT_DIR [ru|en]
// Writes background.png (1x) and background@2x.png (2x), 660x600 pt (spare space at the bottom for the Finder status bar).
import AppKit

let W: CGFloat = 660, H: CGFloat = 640
let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "."
let lang = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "ru"
func L(_ ru: String, _ en: String) -> String { lang == "en" ? en : ru }
func y(_ top: CGFloat) -> CGFloat { H - top }

let ink = NSColor(calibratedWhite: 0.15, alpha: 1)
let grey = NSColor(calibratedWhite: 0.42, alpha: 1)
let accent = NSColor(calibratedRed: 0.80, green: 0.40, blue: 0.20, alpha: 1)   // Claude-like terracotta
let blue = NSColor(calibratedRed: 0.0, green: 0.4, blue: 0.85, alpha: 1)

func text(_ s: String, _ rect: NSRect, size: CGFloat, weight: NSFont.Weight = .regular,
          color: NSColor = ink, align: NSTextAlignment = .left) {
    let p = NSMutableParagraphStyle(); p.alignment = align; p.lineBreakMode = .byWordWrapping; p.lineSpacing = 2
    NSAttributedString(string: s, attributes: [.font: NSFont.systemFont(ofSize: size, weight: weight),
                                               .foregroundColor: color, .paragraphStyle: p]).draw(in: rect)
}

func badge(_ n: String, cx: CGFloat, top: CGFloat) {
    let r = NSRect(x: cx - 13, y: y(top) - 13, width: 26, height: 26)
    accent.setFill(); NSBezierPath(ovalIn: r).fill()
    text(n, NSRect(x: r.minX, y: r.minY + 3, width: r.width, height: r.height), size: 14, weight: .bold, color: .white, align: .center)
}

func card(top: CGFloat, height: CGFloat) {
    NSColor(calibratedWhite: 1, alpha: 0.62).setFill()
    NSBezierPath(roundedRect: NSRect(x: 28, y: y(top + height), width: W - 56, height: height), xRadius: 16, yRadius: 16).fill()
}

func render(scale: CGFloat, to path: String) {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(W * scale), pixelsHigh: Int(H * scale),
                               bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                               colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    rep.size = NSSize(width: W, height: H)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

    NSGradient(colors: [NSColor(calibratedRed: 0.99, green: 0.97, blue: 0.95, alpha: 1),
                        NSColor(calibratedRed: 0.93, green: 0.92, blue: 0.96, alpha: 1)])!
        .draw(in: NSRect(x: 0, y: 0, width: W, height: H), angle: -90)
    accent.setFill(); NSRect(x: 0, y: H - 6, width: W / 2, height: 6).fill()
    blue.setFill(); NSRect(x: W / 2, y: H - 6, width: W / 2, height: 6).fill()

    text("Claude in Safari", NSRect(x: 0, y: y(60), width: W, height: 36), size: 26, weight: .bold, align: .center)
    text(L("Claude управляет вашим настоящим Safari  ·  неофициальный, не связан с Anthropic", "Claude drives your real Safari  ·  unofficial, not affiliated with Anthropic"),
         NSRect(x: 0, y: y(86), width: W, height: 20), size: 12.5, color: grey, align: .center)

    // icon rows (icons are placed by dmgbuild at x=120): wizard 170, app 300, server 430, readme 540
    let tops: [CGFloat] = [108, 240, 372, 504]
    card(top: tops[0], height: 126); card(top: tops[1], height: 126); card(top: tops[2], height: 126); card(top: tops[3], height: 90)
    badge("1", cx: 52, top: tops[0] + 22); badge("2", cx: 52, top: tops[1] + 22); badge("3", cx: 52, top: tops[2] + 22)

    let tx: CGFloat = 215, tw: CGFloat = W - tx - 44
    func block(_ i: Int, _ title: String, _ body: String, x: CGFloat = 215) {
        let w = W - x - 44
        text(title, NSRect(x: x, y: y(tops[i] + 38), width: w, height: 20), size: 15, weight: .semibold)
        text(body, NSRect(x: x, y: y(tops[i] + 118), width: w, height: 76), size: 11.5, color: grey)
    }
    block(0, L("Запустите мастер", "Run the wizard"),
          L("Двойной клик (если macOS не открывает: правый клик → Открыть). Мастер скопирует приложение в «Программы», поможет получить бесплатный сертификат Apple Development и подпишет расширение.", "Double-click it (if macOS refuses: right-click → Open). The wizard copies the app to Applications, helps you get a free Apple Development certificate and signs the extension."))
    block(1, L("Включите расширение в Safari", "Enable the extension in Safari"),
          L("Safari → Настройки → Расширения: включите его и разрешите все сайты. Без подписи: перетащите приложение на «Applications», запустите и включите Разработка → Разрешить неподписанные расширения (см. README).", "Safari → Settings → Extensions: turn it on and allow all websites. Without signing: drag the app to Applications, launch it and use Develop → Allow Unsigned Extensions (see README)."), x: 290)
    do { // arrow between the app and the Applications shortcut (unsigned route)
        accent.setStroke(); accent.setFill()
        let l = NSBezierPath(); l.move(to: NSPoint(x: 128, y: y(292))); l.line(to: NSPoint(x: 152, y: y(292)))
        l.lineWidth = 3; l.lineCapStyle = .round; l.stroke()
        let h = NSBezierPath(); h.move(to: NSPoint(x: 162, y: y(292))); h.line(to: NSPoint(x: 150, y: y(285))); h.line(to: NSPoint(x: 150, y: y(299))); h.close(); h.fill()
    }
    block(2, L("Сервер для Claude", "Server for Claude"),
          L("Мастер сам положит папку в /Users/Shared и добавит её в Claude Desktop. Без мастера — см. README.txt. Затем перезапустите Claude Desktop (⌘Q).", "The wizard puts the folder into /Users/Shared and adds it to Claude Desktop. Without the wizard, see README.txt. Then restart Claude Desktop (⌘Q)."), x: 215)
    text(L("README.txt: краткая инструкция. Полная, с примерами и вариантом без сертификата: github.com/KLon777/claude-in-safari", "README.txt: short instructions. Full guide, with examples and the no-certificate route: github.com/KLon777/claude-in-safari"),
         NSRect(x: tx, y: y(tops[3] + 62), width: tw, height: 44), size: 11.5, color: grey)

    NSGraphicsContext.restoreGraphicsState()
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: path))
}
render(scale: 1, to: out + "/background.png")
render(scale: 2, to: out + "/background@2x.png")
print("ok")
