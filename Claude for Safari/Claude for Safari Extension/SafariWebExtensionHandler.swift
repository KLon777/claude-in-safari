//
//  SafariWebExtensionHandler.swift
//  Claude for Safari Extension
//
//  Native side of the extension: on-device OCR through Vision.
//

import SafariServices
import Vision
import ImageIO

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem
        let message = request?.userInfo?[SFExtensionMessageKey] as? [String: Any]

        let reply: [String: Any]
        if message?["cmd"] as? String == "ocr", let img = message?["img"] as? String {
            reply = ocr(base64: img)
        } else {
            reply = ["error": "unknown command"]
        }

        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: reply]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }

    /// Recognises text in a PNG/JPEG. Boxes are normalised (0...1, origin bottom-left, as Vision returns them).
    private func ocr(base64: String) -> [String: Any] {
        guard let data = Data(base64Encoded: base64),
              let source = CGImageSourceCreateWithData(data as CFData, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
            return ["error": "cannot decode image"]
        }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        let supported = (try? request.supportedRecognitionLanguages()) ?? []
        let wanted = ["ru-RU", "en-US"].filter { supported.contains($0) }
        if !wanted.isEmpty { request.recognitionLanguages = wanted }
        do {
            try VNImageRequestHandler(cgImage: image).perform([request])
        } catch {
            return ["error": "Vision failed: \(error.localizedDescription)"]
        }
        let lines: [[String: Any]] = (request.results ?? []).compactMap { observation in
            guard let best = observation.topCandidates(1).first else { return nil }
            let box = observation.boundingBox
            return ["text": best.string, "conf": Double(best.confidence),
                    "x": Double(box.minX), "y": Double(box.minY), "w": Double(box.width), "h": Double(box.height)]
        }
        return ["lines": lines, "imgW": image.width, "imgH": image.height]
    }
}
