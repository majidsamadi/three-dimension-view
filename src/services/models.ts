import { BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshStandardMaterial, Points, PointsMaterial, type Object3D } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { AppError, IDENTITY_TRANSFORM, LIMITS, type AssetRecord, type GeometryData, type RenderScene, type SceneRecord } from '@/domain/types'
import { cropGeometry, encodeGeometry, transformGeometry, transformMatrix } from '@/domain/geometry'
import { validateGeometry } from '@/domain/validation'

/** Models are normalized to geometry and vertex colours. No remote material/texture URLs are fetched. */
export async function importModel(file: File, projectId: string): Promise<{ scene: SceneRecord; asset: AssetRecord }> {
  if (!file.size || file.size > LIMITS.assetBytes) throw new AppError('Choose a model smaller than 64 MB.')
  const ext = file.name.split('.').pop()?.toLowerCase()
  let data: GeometryData
  if (ext === 'ply') {
    const bytes = await file.arrayBuffer(), header = new TextDecoder().decode(bytes.slice(0, Math.min(bytes.byteLength, 8192)))
    const vertices = Number(header.match(/element vertex\s+(\d+)/)?.[1]), faces = Number(header.match(/element face\s+(\d+)/)?.[1] || 0)
    if (!vertices || vertices > LIMITS.vertices || faces * 3 > LIMITS.indices) throw new AppError('This PLY exceeds the supported geometry budget.')
    const geometry = new PLYLoader().parse(bytes)
    try { data = flattenGeometry(geometry, undefined, faces === 0) } finally { geometry.dispose() }
  } else if (ext === 'obj') {
    const text = await file.text()
    if ((text.match(/^v\s/gm)?.length || 0) > LIMITS.vertices || (text.match(/^f\s/gm)?.length || 0) * 12 > LIMITS.indices) throw new AppError('This OBJ exceeds the supported geometry budget.')
    // OBJLoader does not load MTL files; explicitly strip their declarations.
    const object = new OBJLoader().parse(text.replace(/^\s*(mtllib|usemtl)\s.*$/gm, ''))
    try { data = flattenObject(object) } finally { disposeObject(object) }
  } else if (ext === 'glb') {
    const bytes = await file.arrayBuffer(); validateGLB(bytes)
    const gltf = await new GLTFLoader().parseAsync(bytes, '')
    try { data = flattenObject(gltf.scene) } finally { disposeObject(gltf.scene) }
  } else throw new AppError('Supported model types are GLB, PLY and OBJ. Import a W3D file to restore a complete project.')
  validateGeometry(data)
  const id = crypto.randomUUID()
  const scene: SceneRecord = { id: crypto.randomUUID(), name: file.name.replace(/\.[^.]+$/, '').slice(0, 100) || 'Imported model', geometryId: id, source: 'import', kind: data.indices.length ? 'mesh' : 'points', transform: IDENTITY_TRANSFORM(), vertexCount: data.positions.length / 3, triangleCount: data.indices.length / 3, capturedAt: new Date().toISOString(), durationMs: 0, status: 'review', warnings: ['Imported units are assumed to be metres. Verify scale using a known distance. Texture images and animations are not imported; geometry and vertex colours are retained.'] }
  return { scene, asset: { id, projectId, kind: 'geometry', blob: encodeGeometry(data) } }
}

/** Validate before GLTFLoader sees input: never let a model initiate a network request or decode an unbounded image. */
export function validateGLB(bytes: ArrayBuffer): void {
  if (bytes.byteLength < 20) throw new AppError('Incomplete GLB file.')
  const view = new DataView(bytes)
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength || view.getUint32(16, true) !== 0x4e4f534a) throw new AppError('Only valid GLB 2.0 files are supported.')
  const length = view.getUint32(12, true)
  if (length > LIMITS.manifestBytes || length + 20 > bytes.byteLength) throw new AppError('The GLB metadata is too large or corrupt.')
  let doc: { buffers?: { uri?: string }[]; images?: unknown[]; extensionsRequired?: string[]; accessors?: { count?: number }[] }
  try { doc = JSON.parse(new TextDecoder().decode(bytes.slice(20, 20 + length))) } catch { throw new AppError('Invalid GLB metadata.') }
  if (doc.buffers?.some(b => b.uri)) throw new AppError('Models with external buffers are not accepted. Export a self-contained GLB.')
  if (doc.images?.length) throw new AppError('This importer accepts geometry-only GLB files. Export without texture images, or use PLY with vertex colours.')
  if (doc.extensionsRequired?.length) throw new AppError('Compressed or extension-dependent GLB files are not supported. Export an uncompressed standard GLB.')
  if (doc.accessors?.some(a => !Number.isSafeInteger(a.count) || Number(a.count) < 0 || Number(a.count) > LIMITS.indices)) throw new AppError('The GLB exceeds the supported geometry budget.')
}

function flattenGeometry(g: BufferGeometry, colour = new Color(0x93a89f), points = false): GeometryData {
  const position = g.getAttribute('position'), color = g.getAttribute('color')
  if (!position || position.count > LIMITS.vertices) throw new AppError('Missing or oversized vertex data.')
  const positions = new Float32Array(position.count * 3), colors = new Float32Array(positions.length)
  for (let i = 0; i < position.count; i++) {
    positions.set([position.getX(i), position.getY(i), position.getZ(i)], i * 3)
    colors.set(color ? [color.getX(i), color.getY(i), color.getZ(i)] : [colour.r, colour.g, colour.b], i * 3)
  }
  const indices = points ? new Uint32Array() : g.index ? Uint32Array.from(g.index.array) : Uint32Array.from({ length: Math.floor(position.count / 3) * 3 }, (_, i) => i)
  return { positions, colors, indices }
}
function flattenObject(object: Object3D): GeometryData {
  const parts: GeometryData[] = []; let vc = 0, ic = 0
  object.updateMatrixWorld(true)
  object.traverse(child => {
    if (!(child instanceof Mesh || child instanceof Points)) return
    const g = child.geometry.clone().applyMatrix4(child.matrixWorld)
    const material = Array.isArray(child.material) ? child.material[0] : child.material
    const color = 'color' in material && material.color instanceof Color ? material.color : undefined
    try {
      const data = flattenGeometry(g, color, child instanceof Points)
      vc += data.positions.length / 3; ic += data.indices.length
      if (vc > LIMITS.vertices || ic > LIMITS.indices) throw new AppError('The combined model exceeds the supported geometry budget.')
      parts.push(data)
    } finally { g.dispose() }
  })
  return combineGeometry(parts)
}
export function combineGeometry(parts: GeometryData[]): GeometryData {
  const vc = parts.reduce((n, g) => n + g.positions.length / 3, 0), ic = parts.reduce((n, g) => n + g.indices.length, 0)
  if (vc > LIMITS.vertices || ic > LIMITS.indices) throw new AppError('The combined export is too large. Export smaller projects separately.')
  const positions = new Float32Array(vc * 3), colors = new Float32Array(vc * 3), indices = new Uint32Array(ic)
  let v = 0, t = 0
  for (const g of parts) {
    positions.set(g.positions, v * 3)
    if (g.colors.length) colors.set(g.colors, v * 3); else colors.fill(0.6, v * 3, v * 3 + g.positions.length)
    for (const index of g.indices) indices[t++] = index + v
    v += g.positions.length / 3
  }
  return { positions, colors, indices }
}
export function bufferGeometry(g: GeometryData): BufferGeometry {
  const result = new BufferGeometry().setAttribute('position', new BufferAttribute(g.positions, 3))
  if (g.colors.length) result.setAttribute('color', new BufferAttribute(g.colors, 3))
  if (g.indices.length) { result.setIndex(new BufferAttribute(g.indices, 1)); result.computeVertexNormals() }
  result.computeBoundingSphere(); return result
}
export function disposeObject(object: Object3D): void {
  object.traverse(child => {
    if (child instanceof Mesh || child instanceof Points) { child.geometry.dispose(); for (const m of Array.isArray(child.material) ? child.material : [child.material]) m.dispose() }
  })
}
export async function exportModel(scenes: RenderScene[], format: 'glb' | 'ply' | 'obj'): Promise<Blob> {
  if (!scenes.length) throw new AppError('There is no geometry to export yet.')
  if (format === 'glb') {
    const root = new Group()
    for (const { scene, geometry } of scenes) {
      const data = cropGeometry(geometry, scene.crop); if (!data.positions.length) continue
      const g = bufferGeometry(data)
      const object = data.indices.length ? new Mesh(g, new MeshStandardMaterial({ vertexColors: !!data.colors.length, color: data.colors.length ? 0xffffff : 0x93a89f, roughness: 0.9 })) : new Points(g, new PointsMaterial({ vertexColors: !!data.colors.length, size: 0.025 }))
      object.name = scene.name; object.applyMatrix4(transformMatrix(scene.transform)); root.add(object)
    }
    if (!root.children.length) throw new AppError('The current crop hides all geometry.')
    try { const result = await new GLTFExporter().parseAsync(root, { binary: true }); return new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' }) }
    finally { disposeObject(root) }
  }
  const g = combineGeometry(scenes.map(({ scene, geometry }) => transformGeometry(cropGeometry(geometry, scene.crop), scene.transform)))
  if (!g.positions.length) throw new AppError('The current crop hides all geometry.')
  if (format === 'obj') {
    const lines = ['# Three Dimension View — metres, Y up; vertex colour extension']
    for (let i = 0; i < g.positions.length; i += 3) lines.push(`v ${g.positions[i]} ${g.positions[i + 1]} ${g.positions[i + 2]} ${g.colors[i]} ${g.colors[i + 1]} ${g.colors[i + 2]}`)
    for (let i = 0; i < g.indices.length; i += 3) lines.push(`f ${g.indices[i] + 1} ${g.indices[i + 1] + 1} ${g.indices[i + 2] + 1}`)
    if (!g.indices.length) lines.push(`p ${Array.from({ length: g.positions.length / 3 }, (_, i) => i + 1).join(' ')}`)
    return new Blob([lines.join('\n')], { type: 'text/plain' })
  }
  const n = g.positions.length / 3, f = g.indices.length / 3
  const header = `ply\nformat binary_little_endian 1.0\ncomment Three Dimension View metres Y-up\nelement vertex ${n}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nelement face ${f}\nproperty list uchar uint vertex_indices\nend_header\n`
  const bytes = new ArrayBuffer(n * 15 + f * 13), view = new DataView(bytes); let offset = 0
  for (let i = 0; i < n; i++) { for (let k = 0; k < 3; k++) view.setFloat32(offset + k * 4, g.positions[i * 3 + k], true); for (let k = 0; k < 3; k++) view.setUint8(offset + 12 + k, Math.round(new Color(g.colors[i * 3], g.colors[i * 3 + 1], g.colors[i * 3 + 2]).convertLinearToSRGB().toArray()[k] * 255)); offset += 15 }
  for (let i = 0; i < f; i++) { view.setUint8(offset++, 3); for (let k = 0; k < 3; k++) { view.setUint32(offset, g.indices[i * 3 + k], true); offset += 4 } }
  return new Blob([header, bytes], { type: 'application/octet-stream' })
}
