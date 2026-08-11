// Cursor-free screen recorder using ScreenCaptureKit.
//
// The avfoundation capture composites the macOS hardware cursor into the
// video regardless of -capture_cursor, and that hardware cursor flickers /
// drops out during heavy repaints (scrolling lists, animating Task Center).
// ScreenCaptureKit's showsCursor=false gives a truly cursor-free capture;
// the demo recorder then overlays its own always-present synthetic cursor.
//
// Usage:  sckrecord OUT.mp4 [fps] [window-title-substring]
// Records until SIGINT/SIGTERM, then finalizes the mp4.
//
// With a window-title substring it captures THAT WINDOW's own content, not the
// slice of display the window happens to sit on. Display capture plus a crop
// records whatever is frontmost inside that rectangle: a take once ended with a
// chat window composited under the demo captions, because the app came forward
// mid-recording and owned those pixels. Window capture cannot pick up another
// app's content no matter what is in front, so nothing outside the demo can
// leak into a reel.
import AppKit
import ScreenCaptureKit
import AVFoundation
import CoreMedia
import Dispatch
import Foundation

func err(_ s: String) { FileHandle.standardError.write((s + "\n").data(using: .utf8)!) }

// Window capture talks to the window server, which a plain command-line tool
// has not connected to: SCContentFilter(desktopIndependentWindow:) aborts with
// "CGS_REQUIRE_INIT" without this. Display capture happens to initialise it
// lazily, which is why only the window path needed it. .accessory keeps the
// recorder out of the Dock so it cannot appear in its own capture.
_ = NSApplication.shared
NSApplication.shared.setActivationPolicy(.accessory)

let outPath = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "/tmp/sck.mp4"
let fps = CommandLine.arguments.count > 2 ? (Int(CommandLine.arguments[2]) ?? 30) : 30
let windowMatch = CommandLine.arguments.count > 3 ? CommandLine.arguments[3] : ""

final class Rec: NSObject, SCStreamOutput, SCStreamDelegate {
    var writer: AVAssetWriter!
    var vinput: AVAssetWriterInput!
    var adaptor: AVAssetWriterInputPixelBufferAdaptor!
    var stream: SCStream!
    var started = false
    var stopped = false
    let q = DispatchQueue(label: "sck.rec")
    var w = 0, h = 0
    var nDelivered = 0, nAppended = 0, nNotReady = 0

    func start() async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        let filter: SCContentFilter
        if !windowMatch.isEmpty {
            // Largest match wins: Obsidian also owns small helper windows (and a
            // settings window since 1.13) whose titles share the vault name, and
            // picking one of those would record a sliver instead of the demo.
            let matches = content.windows.filter { ($0.title ?? "").contains(windowMatch) }
            guard let win = matches.max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height })
            else { throw NSError(domain: "sck", code: 2,
                                 userInfo: [NSLocalizedDescriptionKey: "no window titled *\(windowMatch)*"]) }
            w = Int(win.frame.width) * 2
            h = Int(win.frame.height) * 2
            filter = SCContentFilter(desktopIndependentWindow: win)
            // The harness maps its cursor trace from screen points into video
            // pixels, so it needs the origin this capture is relative to.
            err("sck: window origin \(Int(win.frame.origin.x)) \(Int(win.frame.origin.y)) size \(Int(win.frame.width)) \(Int(win.frame.height))")
        } else {
            guard let display = content.displays.first else { throw NSError(domain: "sck", code: 1) }
            w = display.width * 2
            h = display.height * 2
            filter = SCContentFilter(display: display, excludingWindows: [])
        }
        let cfg = SCStreamConfiguration()
        cfg.width = w
        cfg.height = h
        cfg.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps))
        cfg.showsCursor = false
        cfg.pixelFormat = kCVPixelFormatType_32BGRA
        cfg.queueDepth = 8

        try? FileManager.default.removeItem(atPath: outPath)
        writer = try AVAssetWriter(outputURL: URL(fileURLWithPath: outPath), fileType: .mp4)
        let settings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: w,
            AVVideoHeightKey: h,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: 18_000_000,
                AVVideoMaxKeyFrameIntervalKey: fps,
            ],
        ]
        vinput = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
        vinput.expectsMediaDataInRealTime = true
        adaptor = AVAssetWriterInputPixelBufferAdaptor(
            assetWriterInput: vinput,
            sourcePixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
        writer.add(vinput)

        stream = SCStream(filter: filter, configuration: cfg, delegate: self)
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: q)
        try await stream.startCapture()
        err("sck: recording \(w)x\(h) @ \(fps) -> \(outPath)")
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
        guard !stopped, type == .screen, sb.isValid, sb.numSamples > 0 else { return }
        nDelivered += 1
        guard let pb = CMSampleBufferGetImageBuffer(sb) else { return }
        let pts = CMSampleBufferGetPresentationTimeStamp(sb)
        if !started {
            guard writer.startWriting() else { err("sck: startWriting failed \(String(describing: writer.error))"); return }
            writer.startSession(atSourceTime: pts)
            started = true
            // Wall-clock ms of the first written frame — the harness uses this
            // as the recording start so the synthetic-cursor trace aligns.
            let epochMs = Int(Date().timeIntervalSince1970 * 1000)
            err("sck: firstframe \(epochMs)")
        }
        if vinput.isReadyForMoreMediaData {
            adaptor.append(pb, withPresentationTime: pts)
            nAppended += 1
        } else {
            nNotReady += 1
        }
    }

    func stop() {
        stopped = true
        let sem = DispatchSemaphore(value: 0)
        Task {
            try? await stream.stopCapture()
            if started { vinput.markAsFinished(); await writer.finishWriting() }
            sem.signal()
        }
        _ = sem.wait(timeout: .now() + 10)
        err("sck: finalized delivered=\(nDelivered) appended=\(nAppended) notReady=\(nNotReady)")
    }
}

let rec = Rec()

var sigSources: [DispatchSourceSignal] = []
for sig in [SIGINT, SIGTERM] {
    signal(sig, SIG_IGN)
    let src = DispatchSource.makeSignalSource(signal: sig, queue: .main)
    src.setEventHandler { rec.stop(); exit(0) }
    src.resume()
    sigSources.append(src)
}

Task {
    do { try await rec.start() } catch { err("sck error: \(error)"); exit(1) }
}
dispatchMain()
