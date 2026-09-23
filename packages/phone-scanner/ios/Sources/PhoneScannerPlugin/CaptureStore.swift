import Foundation

struct CapturedMesh {
    var positions: [Float] = []
    var colors: [Float] = []
    var indices: [UInt32] = []
}

enum CaptureFailure: LocalizedError {
    case invalid(String)
    var errorDescription: String? { if case .invalid(let message) = self { return message }; return nil }
}

/// Private binary snapshots. All operations run on the plugin's serial storage queue.
/// A snapshot is advertised only after its complete geometry and metadata are persisted.
final class CaptureStore {
    private let directory: URL
    init() throws {
        var root = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("ThreeDimensionCapture", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var values = URLResourceValues(); values.isExcludedFromBackup = true; try root.setResourceValues(values)
        directory = root
    }
    private func url(_ id: String, _ suffix: String) throws -> URL {
        guard UUID(uuidString: id) != nil else { throw CaptureFailure.invalid("Invalid capture identifier.") }
        return directory.appendingPathComponent(id.lowercased()).appendingPathExtension(suffix)
    }
    func save(id: String, mesh: CapturedMesh, metadata: [String: Any]) throws {
        guard mesh.positions.count > 0, mesh.positions.count % 3 == 0, mesh.positions.count <= 1_500_000,
              mesh.colors.count == mesh.positions.count, mesh.indices.count <= 3_000_000, mesh.indices.count % 3 == 0,
              mesh.positions.allSatisfy({ $0.isFinite && abs($0) <= 100000 }), mesh.colors.allSatisfy({ $0.isFinite && $0 >= 0 && $0 <= 1 }), mesh.indices.allSatisfy({ $0 < UInt32(mesh.positions.count / 3) }) else { throw CaptureFailure.invalid("No valid geometry was captured. Move slowly through a well-lit area and try again.") }
        var data = Data()
        for number: UInt32 in [0x47443357, 1, UInt32(mesh.positions.count / 3), UInt32(mesh.indices.count), 1] { var value = number.littleEndian; withUnsafeBytes(of: &value) { data.append(contentsOf: $0) } }
        mesh.positions.withUnsafeBytes { data.append(contentsOf: $0) }; mesh.colors.withUnsafeBytes { data.append(contentsOf: $0) }; mesh.indices.withUnsafeBytes { data.append(contentsOf: $0) }
        try data.write(to: url(id, "mesh"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        let json = try JSONSerialization.data(withJSONObject: metadata, options: [.sortedKeys])
        try json.write(to: url(id, "json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    func recoveries() throws -> [[String: Any]] {
        try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).filter { $0.pathExtension == "json" }.compactMap { file in
            guard let data = try? Data(contentsOf: file), data.count < 32768,
                  let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let id = value["sessionId"] as? String, let meshURL = try? url(id, "mesh"), FileManager.default.fileExists(atPath: meshURL.path) else { return nil }
            guard let snapshot = try? Data(contentsOf: meshURL, options: .mappedIfSafe), snapshot.count >= 20, snapshot.count <= 64 * 1024 * 1024 else { return nil }
            let header: [UInt32] = snapshot.withUnsafeBytes { bytes in (0..<5).map { UInt32(littleEndian: bytes.loadUnaligned(fromByteOffset: $0 * 4, as: UInt32.self)) } }
            guard header[0] == 0x47443357, header[1] == 1, header[4] == 1, header[2] > 0, header[2] <= 500000, header[3] <= 3000000, header[3] % 3 == 0, snapshot.count == 20 + Int(header[2]) * 24 + Int(header[3]) * 4 else { return nil }
            var recovered = value
            recovered["vertices"] = Int(header[2]); recovered["indices"] = Int(header[3])
            return recovered
        }
    }
    func chunk(id: String, vertexOffset: Int, vertexCount: Int, indexOffset: Int, indexCount: Int) throws -> [String: Any] {
        guard vertexOffset >= 0, vertexCount >= 0, vertexCount <= 4096, indexOffset >= 0, indexCount >= 0, indexCount <= 12288 else { throw CaptureFailure.invalid("Invalid scan chunk range.") }
        let data = try Data(contentsOf: url(id, "mesh"), options: .mappedIfSafe)
        guard data.count >= 20, data.count <= 64 * 1024 * 1024 else { throw CaptureFailure.invalid("Invalid scan snapshot size.") }
        return try data.withUnsafeBytes { bytes in
            func u32(_ offset: Int) -> UInt32 { UInt32(littleEndian: bytes.loadUnaligned(fromByteOffset: offset, as: UInt32.self)) }
            let vertices = Int(u32(8)), indices = Int(u32(12))
            guard u32(0) == 0x47443357, u32(4) == 1, u32(16) == 1, vertices <= 500000, indices <= 3000000,
                  data.count == 20 + vertices * 24 + indices * 4,
                  vertexOffset <= vertices, vertexCount <= vertices - vertexOffset, indexOffset <= indices, indexCount <= indices - indexOffset else { throw CaptureFailure.invalid("The scan snapshot is incomplete or the chunk is out of range.") }
            var positions: [Float] = [], colors: [Float] = [], triangles: [UInt32] = []
            for i in 0..<(vertexCount * 3) { positions.append(Float(bitPattern: u32(20 + (vertexOffset * 3 + i) * 4))); colors.append(Float(bitPattern: u32(20 + vertices * 12 + (vertexOffset * 3 + i) * 4))) }
            for i in 0..<indexCount { triangles.append(u32(20 + vertices * 24 + (indexOffset + i) * 4)) }
            return ["positions": positions, "colors": colors, "indices": triangles]
        }
    }
    func discard(id: String) throws {
        for suffix in ["json", "mesh"] { let file = try url(id, suffix); if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) } }
    }
}
