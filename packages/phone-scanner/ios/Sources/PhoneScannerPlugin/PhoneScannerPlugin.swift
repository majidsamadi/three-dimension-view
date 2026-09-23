import Foundation
import UIKit
import ARKit
import SceneKit
import AVFoundation
import Capacitor

@objc(PhoneScannerPlugin)
public class PhoneScannerPlugin: CAPPlugin, CAPBridgedPlugin, ARSessionDelegate, ARSCNViewDelegate {
    public let identifier = "PhoneScannerPlugin"
    public let jsName = "PhoneScanner"
    public let pluginMethods: [CAPPluginMethod] = ["getCapabilities", "start", "pause", "resume", "stop", "cancel", "getRecoveries", "readChunk", "discard"].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }
    private var view: ARSCNView?
    private var configuration: ARWorldTrackingConfiguration?
    private var meshes: [UUID: CapturedMesh] = [:]
    private var sessionId = "", projectId = "", capturedAt = ""
    private var started: TimeInterval = 0, lastEvent: TimeInterval = 0, lastCheckpoint: TimeInterval = 0
    private var paused = false, budgetReached = false, frames = 0, vertexBudget = 120000
    private var tracking = "Initializing tracking", warning = ""
    private var timer: Timer?
    private let storageQueue = DispatchQueue(label: "com.wisestay.scanner.storage")
    private var previousOpaque = true
    private var previousBackground: UIColor?
    private var permissionPending = false
    override public func load() {
        NotificationCenter.default.addObserver(self, selector: #selector(backgrounded), name: UIApplication.willResignActiveNotification, object: nil)
    }
    deinit { NotificationCenter.default.removeObserver(self); timer?.invalidate() }
    @objc public func getCapabilities(_ call: CAPPluginCall) {
        let supported = ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh)
        call.resolve(["platform": "ios", "available": supported, "support": supported ? "supported" : "unsupported", "reason": supported ? "ARKit mesh reconstruction is supported. Camera permission is requested when capture starts." : "This device does not support ARKit mesh reconstruction. A supported LiDAR-equipped device is required.", "source": "arkit-mesh", "canPause": true])
    }
    @objc public func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.view == nil, !self.permissionPending else { call.reject("A capture is already active.", "BUSY"); return }
            guard ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh), let id = call.getString("sessionId"), UUID(uuidString: id) != nil, let project = call.getString("projectId"), UUID(uuidString: project) != nil else { call.reject("Unsupported device or invalid capture identifiers.", "UNSUPPORTED"); return }
            self.permissionPending = true
            AVCaptureDevice.requestAccess(for: .video) { allowed in
                DispatchQueue.main.async {
                    self.permissionPending = false
                    guard allowed else { call.reject("Camera permission was denied. Enable it in Settings before scanning.", "PERMISSION_DENIED"); return }
                    guard let webView = self.bridge?.webView, let parent = webView.superview else { call.reject("The native camera host is unavailable.", "NO_HOST"); return }
                    self.sessionId = id; self.projectId = project; self.capturedAt = ISO8601DateFormatter().string(from: Date()); self.started = ProcessInfo.processInfo.systemUptime; self.lastCheckpoint = self.started
                    self.meshes = [:]; self.frames = 0; self.paused = false; self.budgetReached = false; self.warning = ""; self.vertexBudget = call.getString("quality") == "detail" ? 250000 : 120000
                    let ar = ARSCNView(frame: parent.bounds); ar.autoresizingMask = [.flexibleWidth, .flexibleHeight]; ar.delegate = self; ar.session.delegate = self; ar.session.delegateQueue = .main; ar.automaticallyUpdatesLighting = true
                    self.previousOpaque = webView.isOpaque; self.previousBackground = webView.backgroundColor; webView.isOpaque = false; webView.backgroundColor = .clear; webView.scrollView.backgroundColor = .clear
                    parent.insertSubview(ar, belowSubview: webView); self.view = ar
                    let config = ARWorldTrackingConfiguration(); config.sceneReconstruction = .mesh; config.environmentTexturing = .none
                    self.configuration = config; ar.session.run(config, options: [.resetTracking, .removeExistingAnchors])
                    self.timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in self?.publish() }
                    call.resolve()
                }
            }
        }
    }
    @objc public func pause(_ call: CAPPluginCall) { DispatchQueue.main.async { guard self.view != nil else { call.reject("No capture is active."); return }; self.paused = true; self.view?.session.pause(); self.checkpoint(); self.publish(); call.resolve() } }
    @objc public func resume(_ call: CAPPluginCall) { DispatchQueue.main.async { guard let config = self.configuration, let view = self.view, !self.budgetReached else { call.reject("Capture cannot resume. Save this section and start a new capture."); return }; self.paused = false; view.session.run(config); self.publish(); call.resolve() } }
    @objc private func backgrounded() { guard view != nil else { return }; paused = true; view?.session.pause(); tracking = "Paused when the app left the foreground"; checkpoint(); publish() }
    @objc public func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.view != nil else { call.reject("No capture is active.", "NO_CAPTURE"); return }
            self.paused = true; self.view?.session.pause(); let mesh = self.combined(), metadata = self.metadata(mesh), id = self.sessionId; self.removeCamera()
            self.storageQueue.async {
                do { try CaptureStore().save(id: id, mesh: mesh, metadata: metadata); call.resolve(metadata) }
                catch { call.reject(error.localizedDescription, "SAVE_FAILED") }
            }
        }
    }
    @objc public func cancel(_ call: CAPPluginCall) { DispatchQueue.main.async { let id = self.sessionId; self.removeCamera(); self.meshes.removeAll(); self.storageQueue.async { do { if UUID(uuidString: id) != nil { try CaptureStore().discard(id: id) }; call.resolve() } catch { call.reject(error.localizedDescription) } } } }
    @objc public func getRecoveries(_ call: CAPPluginCall) { storageQueue.async { do { call.resolve(["results": try CaptureStore().recoveries()]) } catch { call.reject(error.localizedDescription) } } }
    @objc public func readChunk(_ call: CAPPluginCall) {
        guard let id = call.getString("sessionId"), let vo = call.getInt("vertexOffset"), let vc = call.getInt("vertexCount"), let io = call.getInt("indexOffset"), let ic = call.getInt("indexCount") else { call.reject("Missing chunk parameters."); return }
        storageQueue.async { do { call.resolve(try CaptureStore().chunk(id: id, vertexOffset: vo, vertexCount: vc, indexOffset: io, indexCount: ic)) } catch { call.reject(error.localizedDescription) } }
    }
    @objc public func discard(_ call: CAPPluginCall) { guard let id = call.getString("sessionId") else { call.reject("Missing capture ID."); return }; storageQueue.async { do { try CaptureStore().discard(id: id); call.resolve() } catch { call.reject(error.localizedDescription) } } }
    private func removeCamera() {
        timer?.invalidate(); timer = nil; view?.session.pause(); view?.delegate = nil; view?.session.delegate = nil; view?.removeFromSuperview(); view = nil; configuration = nil
        if let web = bridge?.webView { web.isOpaque = previousOpaque; web.backgroundColor = previousBackground; web.scrollView.backgroundColor = previousBackground }
    }
    public func session(_ session: ARSession, didUpdate frame: ARFrame) {
        guard view != nil else { return }; frames += 1
        switch frame.camera.trackingState {
        case .normal: tracking = "Tracking real surfaces"
        case .notAvailable: tracking = "Tracking unavailable — stop or move back to a familiar area"
        case .limited(let reason):
            switch reason { case .excessiveMotion: tracking = "Move more slowly"; case .insufficientFeatures: tracking = "Find a brighter, textured surface"; case .initializing: tracking = "Initializing tracking"; case .relocalizing: tracking = "Relocalizing — return to a familiar area"; @unknown default: tracking = "Tracking limited" }
        }
    }
    public func session(_ session: ARSession, didAdd anchors: [ARAnchor]) { update(anchors, session.currentFrame) }
    public func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) { update(anchors, session.currentFrame) }
    public func session(_ session: ARSession, didRemove anchors: [ARAnchor]) { for anchor in anchors { meshes.removeValue(forKey: anchor.identifier) } }
    public func session(_ session: ARSession, didFailWithError error: Error) { paused = true; tracking = "Tracking failed"; warning = error.localizedDescription; checkpoint(); publish() }
    public func sessionWasInterrupted(_ session: ARSession) { paused = true; tracking = "Capture interrupted; review or resume deliberately"; checkpoint(); publish() }
    public func sessionInterruptionEnded(_ session: ARSession) { tracking = "Interruption ended — choose Resume or save the partial scan"; publish() }
    private func update(_ anchors: [ARAnchor], _ frame: ARFrame?) {
        guard !paused, view != nil, let frame = frame, case .normal = frame.camera.trackingState else { return }
        for case let anchor as ARMeshAnchor in anchors {
            let previous = meshes[anchor.identifier]?.positions.count ?? 0
            let current = meshes.values.reduce(0) { $0 + $1.positions.count }
            guard (current - previous) / 3 + anchor.geometry.vertices.count <= vertexBudget else { budgetReached = true; paused = true; warning = "Capture memory budget reached. Save this section and start another section."; view?.session.pause(); break }
            meshes[anchor.identifier] = extract(anchor, frame)
        }
        if ProcessInfo.processInfo.systemUptime - lastCheckpoint > 5 { lastCheckpoint = ProcessInfo.processInfo.systemUptime; checkpoint() }
    }
    private func extract(_ anchor: ARMeshAnchor, _ frame: ARFrame) -> CapturedMesh {
        let source = anchor.geometry.vertices, faces = anchor.geometry.faces
        var result = CapturedMesh(); result.positions.reserveCapacity(source.count * 3); result.colors.reserveCapacity(source.count * 3)
        let image = frame.capturedImage; CVPixelBufferLockBaseAddress(image, .readOnly); defer { CVPixelBufferUnlockBaseAddress(image, .readOnly) }
        let inverse = simd_inverse(frame.camera.transform)
        for i in 0..<source.count {
            let address = source.buffer.contents().advanced(by: source.offset + source.stride * i).assumingMemoryBound(to: Float.self)
            let vertex = SIMD3<Float>(address[0], address[1], address[2])
            let world = anchor.transform * SIMD4<Float>(vertex, 1); result.positions.append(contentsOf: [world.x, world.y, world.z])
            let cameraPoint = inverse * world; var color: [Float] = [0.23, 0.63, 0.45]
            if cameraPoint.z < -0.1 && CVPixelBufferGetPlaneCount(image) >= 2 {
                let width = CVPixelBufferGetWidthOfPlane(image, 0), height = CVPixelBufferGetHeightOfPlane(image, 0)
                let p = frame.camera.projectPoint(SIMD3<Float>(world.x,world.y,world.z), orientation: .landscapeRight, viewportSize: CGSize(width: width, height: height))
                let x = p.x.isFinite ? Int(p.x) : -1, y = p.y.isFinite ? Int(p.y) : -1
                if x >= 0 && y >= 0 && x < width && y < height, let yData = CVPixelBufferGetBaseAddressOfPlane(image, 0)?.assumingMemoryBound(to: UInt8.self), let uvData = CVPixelBufferGetBaseAddressOfPlane(image, 1)?.assumingMemoryBound(to: UInt8.self) {
                    let luma = Float(yData[y * CVPixelBufferGetBytesPerRowOfPlane(image, 0) + x]) / 255
                    let uvOffset = (y / 2) * CVPixelBufferGetBytesPerRowOfPlane(image, 1) + (x / 2) * 2
                    let cb = Float(uvData[uvOffset]) / 255 - 0.5, cr = Float(uvData[uvOffset + 1]) / 255 - 0.5
                    color = [luma + 1.402 * cr, luma - 0.344136 * cb - 0.714136 * cr, luma + 1.772 * cb].map { value in let srgb = max(0, min(1, value)); return srgb <= 0.04045 ? srgb / 12.92 : pow((srgb + 0.055) / 1.055, 2.4) }
                }
            }
            result.colors.append(contentsOf: color)
        }
        guard faces.indexCountPerPrimitive == 3 else { return result }
        for i in 0..<(faces.count * 3) { let address = faces.buffer.contents().advanced(by: i * faces.bytesPerIndex); let value = faces.bytesPerIndex == 2 ? UInt32(address.assumingMemoryBound(to: UInt16.self).pointee) : address.assumingMemoryBound(to: UInt32.self).pointee; result.indices.append(value) }
        return result
    }
    private func combined() -> CapturedMesh {
        var result = CapturedMesh()
        for key in meshes.keys.sorted(by: { $0.uuidString < $1.uuidString }) { guard let part = meshes[key] else { continue }; let offset = UInt32(result.positions.count / 3); result.positions.append(contentsOf: part.positions); result.colors.append(contentsOf: part.colors); result.indices.append(contentsOf: part.indices.map { $0 + offset }) }
        return result
    }
    private func metadata(_ mesh: CapturedMesh) -> [String: Any] {
        var warnings = ["ARKit LiDAR geometry is approximate. Vertex colour is sampled from camera images, not a photorealistic texture atlas.", "This capture has its own local coordinate origin. Separate sessions require manual alignment."]
        if !warning.isEmpty { warnings.append(warning) }
        return ["sessionId": sessionId, "projectId": projectId, "source": "arkit-mesh", "vertices": mesh.positions.count / 3, "indices": mesh.indices.count, "elapsedMs": min((ProcessInfo.processInfo.systemUptime - started) * 1000, 86400000), "capturedAt": capturedAt, "warnings": warnings]
    }
    private func checkpoint() {
        let mesh = combined(); guard !mesh.positions.isEmpty else { return }; let data = metadata(mesh), id = sessionId
        storageQueue.async { do { try CaptureStore().save(id: id, mesh: mesh, metadata: data) } catch { DispatchQueue.main.async { self.warning = "Recovery checkpoint could not be stored. Save this capture before leaving the app." } } }
    }
    private func publish() {
        guard view != nil else { return }
        let count = meshes.values.reduce(0) { $0 + $1.positions.count / 3 }, triangles = meshes.values.reduce(0) { $0 + $1.indices.count / 3 }, step = max(1, Int(ceil(Double(count) / 2000)))
        var preview: [Float] = [], n = 0
        for mesh in meshes.values { for i in stride(from: 0, to: mesh.positions.count, by: 3) { if n % step == 0 { preview.append(contentsOf: mesh.positions[i..<(i+3)]) }; n += 1 } }
        notifyListeners("progress", data: ["sessionId": sessionId, "vertices": count, "triangles": triangles, "frames": frames, "elapsedMs": (ProcessInfo.processInfo.systemUptime - started) * 1000, "tracking": tracking, "paused": paused, "budgetReached": budgetReached, "preview": preview, "message": warning])
    }
    /// Native overlay displays the actual mesh in the camera's coordinate system.
    public func renderer(_ renderer: SCNSceneRenderer, didAdd node: SCNNode, for anchor: ARAnchor) { overlay(node, anchor) }
    public func renderer(_ renderer: SCNSceneRenderer, didUpdate node: SCNNode, for anchor: ARAnchor) { overlay(node, anchor) }
    private func overlay(_ node: SCNNode, _ anchor: ARAnchor) {
        guard let mesh = anchor as? ARMeshAnchor else { return }; let vertices = mesh.geometry.vertices, faces = mesh.geometry.faces
        let source = SCNGeometrySource(buffer: vertices.buffer, vertexFormat: vertices.format, semantic: .vertex, vertexCount: vertices.count, dataOffset: vertices.offset, dataStride: vertices.stride)
        let data = Data(bytes: faces.buffer.contents(), count: faces.count * faces.indexCountPerPrimitive * faces.bytesPerIndex)
        let element = SCNGeometryElement(data: data, primitiveType: .triangles, primitiveCount: faces.count, bytesPerIndex: faces.bytesPerIndex)
        let geometry = SCNGeometry(sources: [source], elements: [element]), material = SCNMaterial(); material.diffuse.contents = UIColor(red: 0.2, green: 0.95, blue: 0.63, alpha: 0.8); material.fillMode = .lines; material.isDoubleSided = true; material.lightingModel = .constant; geometry.materials = [material]; node.geometry = geometry
    }
}
