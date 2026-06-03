// Cursor-free screen recorder using ScreenCaptureKit.
//
// The avfoundation capture composites the macOS hardware cursor into the
// video regardless of -capture_cursor, and that hardware cursor flickers /
// drops out during heavy repaints (scrolling lists, animating Task Center).
// ScreenCaptureKit's showsCursor=false gives a truly cursor-free capture;
// the demo recorder then overlays its own always-present synthetic cursor.
//
// Usage:  sckrecord OUT.mp4 [fps]
// Records the main display until SIGINT/SIGTERM, then finalizes the mp4.
import ScreenCaptureKit
import AVFoundation
import CoreMedia
import Dispatch
import Foundation
import AppKit

// Window capture touches window-server / CoreGraphics APIs that assert
// (CGS_REQUIRE_INIT) unless the process is initialized as a GUI app. A plain
// CLI gets that by creating the shared AppKit app object up front.
_ = NSApplication.shared

func err(_ s: String) { FileHandle.standardError.write((s + "\n").data(using: .utf8)!) }

let outPath = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "/tmp/sck.mp4"
let fps = CommandLine.arguments.count > 2 ? (Int(CommandLine.arguments[2]) ?? 30) : 30

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
        // Capture the Obsidian window directly (not the display) so the reel is
        // immune to focus: the window composites even when another app is front
        // or the user is typing in a terminal. Pick the largest on-screen window
        // owned by Obsidian.
        let appName = CommandLine.arguments.count > 3 ? CommandLine.arguments[3] : "Obsidian"
        let obsidian = content.windows.filter {
            ($0.owningApplication?.applicationName == appName || $0.owningApplication?.bundleIdentifier == "md.obsidian")
                && $0.isOnScreen && $0.frame.width > 400 && $0.frame.height > 300
        }
        guard let window = obsidian.max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }) else {
            throw NSError(domain: "sck", code: 2, userInfo: [NSLocalizedDescriptionKey: "no \(appName) window found"])
        }
        let scale = 2
        w = Int(window.frame.width) * scale
        h = Int(window.frame.height) * scale
        let filter = SCContentFilter(desktopIndependentWindow: window)
        err("sck: window \(Int(window.frame.width))x\(Int(window.frame.height)) @\(Int(window.frame.minX)),\(Int(window.frame.minY))")
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
