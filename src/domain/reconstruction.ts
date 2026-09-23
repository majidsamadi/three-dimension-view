import type { GeometryData, Vec3 } from './types'

/** Incremental voxel surface fusion. It does not fabricate depth for missing pixels. */
export class VoxelFusion {
  private map = new Map<string, number>()
  private vertices: number[] = []
  private colours: number[] = []
  private counts: number[] = []
  private triangles: number[] = []
  private triangleKeys = new Set<string>()
  capacityReached = false
  frames = 0
  constructor(readonly voxelSize = 0.025, readonly maxVertices = 120_000, readonly maxTriangles = 240_000) {
    if (!(voxelSize >= 0.005 && voxelSize <= 0.2) || !Number.isInteger(maxVertices) || maxVertices < 1 || maxVertices > 500_000 || !Number.isInteger(maxTriangles) || maxTriangles < 0 || maxTriangles > 1_000_000) throw new Error('Invalid reconstruction budget.')
  }
  get vertexCount(): number { return this.vertices.length / 3 }
  get triangleCount(): number { return this.triangles.length / 3 }
  addPoint(p: Vec3, color: Vec3 = [0.25, 0.77, 0.6]): number {
    if (p.some(n => !Number.isFinite(n) || Math.abs(n) > 1000) || color.some(n => !Number.isFinite(n) || n < 0 || n > 1)) return -1
    const key = p.map(n => Math.floor(n / this.voxelSize)).join(':')
    const existing = this.map.get(key)
    if (existing !== undefined) {
      const count = Math.min(this.counts[existing], 30), weight = 1 / (count + 1)
      for (let k = 0; k < 3; k++) { this.vertices[existing * 3 + k] += (p[k] - this.vertices[existing * 3 + k]) * weight; this.colours[existing * 3 + k] += (color[k] - this.colours[existing * 3 + k]) * weight }
      this.counts[existing] = count + 1; return existing
    }
    if (this.vertexCount >= this.maxVertices) { this.capacityReached = true; return -1 }
    const index = this.vertexCount; this.map.set(key, index); this.vertices.push(...p); this.colours.push(...color); this.counts.push(1); return index
  }
  addTriangle(a: number, b: number, c: number, maxEdge = 0.25): void {
    if ([a, b, c].some(i => i < 0 || i >= this.vertexCount) || a === b || a === c || b === c || this.triangleCount >= this.maxTriangles) return
    const length = (i: number, j: number) => Math.hypot(...[0, 1, 2].map(k => this.vertices[i * 3 + k] - this.vertices[j * 3 + k]))
    if (length(a, b) > maxEdge || length(a, c) > maxEdge || length(b, c) > maxEdge) return
    const key = [a, b, c].sort((x, y) => x - y).join(':')
    if (!this.triangleKeys.has(key)) { this.triangleKeys.add(key); this.triangles.push(a, b, c) }
  }
  /** Points are row-major world-space samples, with NaN marking unknown depths. */
  integrateGrid(points: Float32Array, width: number, height: number, colors?: Float32Array): void {
    if (width * height * 3 !== points.length || width < 2 || height < 2) throw new Error('Invalid depth grid dimensions.')
    const ids = new Int32Array(width * height).fill(-1)
    for (let i = 0; i < ids.length; i++) ids[i] = this.addPoint([points[i * 3], points[i * 3 + 1], points[i * 3 + 2]], colors ? [colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2]] : undefined)
    for (let y = 0; y < height - 1; y++) for (let x = 0; x < width - 1; x++) {
      const p = y * width + x; this.addTriangle(ids[p], ids[p + width], ids[p + 1]); this.addTriangle(ids[p + 1], ids[p + width], ids[p + width + 1])
    }
    this.frames++
  }
  snapshot(): GeometryData { return { positions: new Float32Array(this.vertices), colors: new Float32Array(this.colours), indices: new Uint32Array(this.triangles) } }
  preview(limit = 2000): GeometryData {
    const positions: number[] = [], colors: number[] = [], step = Math.max(1, Math.ceil(this.vertexCount / limit))
    for (let i = 0; i < this.vertexCount; i += step) { positions.push(...this.vertices.slice(i * 3, i * 3 + 3)); colors.push(...this.colours.slice(i * 3, i * 3 + 3)) }
    return { positions: new Float32Array(positions), colors: new Float32Array(colors), indices: new Uint32Array() }
  }
}

/** Raw depth is distance to the image plane, not radial distance along a normalized ray. */
export function unprojectDepth(u: number, v: number, depth: number, fx: number, fy: number, cx: number, cy: number, cameraToWorld: ArrayLike<number>): Vec3 | null {
  if (![u, v, depth, fx, fy, cx, cy].every(Number.isFinite) || depth <= 0 || depth > 15 || fx <= 0 || fy <= 0 || cameraToWorld.length !== 16) return null
  const x = (u - cx) * depth / fx, y = -(v - cy) * depth / fy, z = -depth
  const p: Vec3 = [cameraToWorld[0] * x + cameraToWorld[4] * y + cameraToWorld[8] * z + cameraToWorld[12], cameraToWorld[1] * x + cameraToWorld[5] * y + cameraToWorld[9] * z + cameraToWorld[13], cameraToWorld[2] * x + cameraToWorld[6] * y + cameraToWorld[10] * z + cameraToWorld[14]]
  return p.every(Number.isFinite) ? p : null
}
