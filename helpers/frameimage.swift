// frameimage — image work for the Stream Deck plugin, using ImageIO.
//
//   frameimage render --in <file> --out <jpg> --width W --height H --fit fill|fit
//       Draws any image (JPEG, PNG, HEIC, WebP, …) upright — applying its
//       rotation flag, which sips ignores — into a W×H sRGB canvas: "fill"
//       covers it and crops the middle, "fit" letterboxes on black. Always
//       writes a plain baseline JPEG, which is all the frame can decode.
//
//   frameimage clipboard --out <file>
//       Saves the clipboard's image (or the first image file copied in
//       Finder) to <file>. Exits 2 if there's no image on the clipboard.

import AppKit
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

func argument(_ flag: String) -> String? {
    let args = CommandLine.arguments
    guard let index = args.firstIndex(of: flag), index + 1 < args.count else { return nil }
    return args[index + 1]
}

func fail(_ message: String, code: Int32 = 1) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(code)
}

/// The image upright, at most `maxPixels` on its long side.
func uprightImage(at url: URL, maxPixels: Int) -> CGImage? {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
    let options: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: maxPixels,
    ]
    return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
}

func render() {
    guard let input = argument("--in"), let output = argument("--out"),
          let width = Int(argument("--width") ?? ""), let height = Int(argument("--height") ?? ""),
          width > 0, height > 0
    else { fail("usage: frameimage render --in F --out F --width W --height H --fit fill|fit") }
    let fill = (argument("--fit") ?? "fill") == "fill"

    // Decode near the size needed (fast for huge photos), never below it.
    guard let image = uprightImage(at: URL(fileURLWithPath: input), maxPixels: max(width, height) * 2) else {
        fail("Couldn't read that picture")
    }
    let sx = Double(width) / Double(image.width), sy = Double(height) / Double(image.height)
    let scale = fill ? max(sx, sy) : min(sx, sy)
    let drawW = Double(image.width) * scale, drawH = Double(image.height) * scale
    let rect = CGRect(x: (Double(width) - drawW) / 2, y: (Double(height) - drawH) / 2, width: drawW, height: drawH)

    guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                  bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
    else { fail("Couldn't make the canvas") }
    context.setFillColor(CGColor(red: 0, green: 0, blue: 0, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    context.interpolationQuality = .high
    context.draw(image, in: rect)

    guard let canvas = context.makeImage(),
          let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: output) as CFURL, UTType.jpeg.identifier as CFString, 1, nil)
    else { fail("Couldn't write the JPEG") }
    CGImageDestinationAddImage(destination, canvas, [kCGImageDestinationLossyCompressionQuality: 0.9] as CFDictionary)
    guard CGImageDestinationFinalize(destination) else { fail("Couldn't write the JPEG") }
}

func clipboard() {
    guard let output = argument("--out") else { fail("usage: frameimage clipboard --out F") }
    let pasteboard = NSPasteboard.general
    // A file copied in Finder: use the file itself (keeps full quality).
    if let urls = pasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL],
       let file = urls.first(where: { (UTType(filenameExtension: $0.pathExtension)?.conforms(to: .image)) ?? false }) {
        do {
            try FileManager.default.copyItem(at: file, to: URL(fileURLWithPath: output))
            return
        } catch {
            fail("Couldn't read the copied file")
        }
    }
    // Image data (a screenshot, "Copy Image" in a browser, …).
    for type in [NSPasteboard.PasteboardType.png, .tiff, NSPasteboard.PasteboardType("public.jpeg"), NSPasteboard.PasteboardType("public.heic")] {
        if let data = pasteboard.data(forType: type) {
            do {
                try data.write(to: URL(fileURLWithPath: output))
                return
            } catch {
                fail("Couldn't save the clipboard image")
            }
        }
    }
    fail("No image on the clipboard", code: 2)
}

switch CommandLine.arguments.dropFirst().first {
case "render": render()
case "clipboard": clipboard()
default: fail("usage: frameimage render|clipboard …")
}
