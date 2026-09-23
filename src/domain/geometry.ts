import { Matrix4, Euler, Quaternion, Vector3 } from 'three'
import { AppError, LIMITS, type Bounds, type GeometryData, type Transform, type Vec3 } from './types'
import { validateGeometry } from './validation'

export function geometryBounds(g: GeometryData): Bounds {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < g.positions.length; i += 3) for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], g.positions[i + k]); max[k] = Math.max(max[k], g.positions[i + k])
  }
  return { min, max }
}
export function transformMatrix(t: Transform): Matrix4 {
  return new Matrix4().compose(new Vector3(...t.position), new Quaternion().setFromEuler(new Euler(...t.rotation.map(v => v * Math.PI / 180) as Vec3, 'XYZ')), new Vector3(t.scale, t.scale, t.scale))
}
export function transformPoint(p: Vec3, t: Transform): Vec3 { return new Vector3(...p).applyMatrix4(transformMatrix(t)).toArray() as Vec3 }
export function distance(a: Vec3, b: Vec3): number { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) }
export function polygonArea(points: Vec3[]): number {
  return Math.abs(points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p[0] * q[2] - q[0] * p[2] }, 0)) / 2
}
export function polygonPerimeter(points: Vec3[]): number { return points.reduce((sum, p, i) => sum + distance(p, points[(i + 1) % points.length]), 0) }
export function isSimplePolygon(points: Vec3[]): boolean {
  if (points.length < 3 || polygonArea(points) < 0.001) return false
  const cross = (a: Vec3, b: Vec3, c: Vec3) => (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0])
  for (let i = 0; i < points.length; i++) {
    if (distance(points[i], points[(i + 1) % points.length]) < 0.001) return false
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue
      const a = points[i], b = points[(i + 1) % points.length], c = points[j], d = points[(j + 1) % points.length]
      if (cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0 && Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])) <= Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) && Math.max(Math.min(a[2], b[2]), Math.min(c[2], d[2])) <= Math.min(Math.max(a[2], b[2]), Math.max(c[2], d[2]))) return false
    }
  }
  return true
}
/** A crop removes complete out-of-bounds triangles rather than leaving dangling indices. */
export function cropGeometry(g: GeometryData, crop?: Bounds): GeometryData {
  if (!crop) return g
  const positions: number[] = [], colors: number[] = [], indices: number[] = []
  const remap = new Int32Array(g.positions.length / 3).fill(-1)
  for (let i = 0; i < remap.length; i++) {
    if ([0, 1, 2].every(k => g.positions[i * 3 + k] >= crop.min[k] && g.positions[i * 3 + k] <= crop.max[k])) {
      remap[i] = positions.length / 3
      positions.push(...g.positions.subarray(i * 3, i * 3 + 3))
      if (g.colors.length) colors.push(...g.colors.subarray(i * 3, i * 3 + 3))
    }
  }
  for (let i = 0; i < g.indices.length; i += 3) {
    const a = remap[g.indices[i]], b = remap[g.indices[i + 1]], c = remap[g.indices[i + 2]]
    if (a >= 0 && b >= 0 && c >= 0) indices.push(a, b, c)
  }
  return { positions: new Float32Array(positions), colors: new Float32Array(colors), indices: new Uint32Array(indices) }
}
export function transformGeometry(g: GeometryData, t: Transform): GeometryData {
  const positions = new Float32Array(g.positions.length), matrix = transformMatrix(t), p = new Vector3()
  for (let i = 0; i < positions.length; i += 3) { p.fromArray(g.positions, i).applyMatrix4(matrix); positions.set(p.toArray(), i) }
  return { positions, colors: g.colors.slice(), indices: g.indices.slice() }
}

const MAGIC = 0x47443357 // "W3DG", little endian
export function encodeGeometry(g: GeometryData): Blob {
  validateGeometry(g)
  const header = new ArrayBuffer(20), view = new DataView(header)
  view.setUint32(0, MAGIC, true); view.setUint32(4, 1, true)
  view.setUint32(8, g.positions.length / 3, true); view.setUint32(12, g.indices.length, true); view.setUint32(16, g.colors.length ? 1 : 0, true)
  return new Blob([header, g.positions.slice().buffer, g.colors.slice().buffer, g.indices.slice().buffer], { type: 'application/vnd.wisestay.geometry' })
}
export async function decodeGeometry(blob: Blob): Promise<GeometryData> {
  if (blob.size < 20 || blob.size > LIMITS.assetBytes) throw new AppError('Invalid geometry file size.', 'INVALID_GEOMETRY')
  const buffer = await blob.arrayBuffer(), view = new DataView(buffer)
  const vc = view.getUint32(8, true), ic = view.getUint32(12, true), flags = view.getUint32(16, true)
  if (view.getUint32(0, true) !== MAGIC || view.getUint32(4, true) !== 1 || vc < 1 || vc > LIMITS.vertices || ic > LIMITS.indices || ic % 3 || flags > 1) throw new AppError('Unsupported geometry format or size.', 'INVALID_GEOMETRY')
  const expected = 20 + vc * 12 * (flags ? 2 : 1) + ic * 4
  if (buffer.byteLength !== expected) throw new AppError('The geometry file is incomplete or corrupt.', 'INVALID_GEOMETRY')
  const positions = new Float32Array(buffer.slice(20, 20 + vc * 12))
  const colors = flags ? new Float32Array(buffer.slice(20 + vc * 12, 20 + vc * 24)) : new Float32Array()
  const indices = new Uint32Array(buffer.slice(20 + vc * 12 * (flags ? 2 : 1)))
  const result = { positions, colors, indices }; validateGeometry(result); return result
}
