import { IDENTITY_TRANSFORM, newProject, type AssetRecord, type GeometryData, type Project, type Vec3 } from './types'
import { encodeGeometry } from './geometry'

/** Deliberately authored sample geometry, never used as a camera/reconstruction fallback. */
export function sampleProject(): { project: Project; assets: AssetRecord[] } {
  const positions: number[] = [], colors: number[] = [], indices: number[] = []
  function box(center: Vec3, size: Vec3, color: Vec3): void {
    const base = positions.length / 3
    for (const [x, y, z] of [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]]) { positions.push(center[0] + x * size[0] / 2, center[1] + y * size[1] / 2, center[2] + z * size[2] / 2); colors.push(...color) }
    for (const i of [0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,3,7,6,3,6,2,0,4,7,0,7,3,1,2,6,1,6,5]) indices.push(base + i)
  }
  box([0,-0.1,0],[8,0.2,6],[0.80,0.85,0.79])
  box([0,1.35,-3],[8,2.7,0.12],[0.9,0.91,0.85]); box([-4,1.35,0],[0.12,2.7,6],[0.86,0.9,0.85])
  box([0,1.35,-1.6],[0.12,2.7,2.8],[0.9,0.91,0.85]); box([0,1.35,2.5],[0.12,2.7,1],[0.9,0.91,0.85])
  box([-2.65,0.42,-1.7],[2.1,0.84,0.9],[0.23,0.5,0.4]); box([-2.65,0.9,-2.08],[2.1,0.55,0.2],[0.19,0.42,0.34])
  box([-2.65,0.45,-0.05],[1.35,0.12,0.8],[0.61,0.43,0.29]); box([-2.65,0.2,-0.05],[0.13,0.4,0.45],[0.44,0.31,0.22])
  box([-2.0,0.012,-0.7],[3.0,0.018,2.5],[0.91,0.88,0.73])
  box([2.25,0.32,-1.6],[2.0,0.64,2.5],[0.91,0.88,0.76]); box([2.25,0.7,-2.75],[2.1,1.2,0.15],[0.61,0.43,0.29])
  box([1.77,0.7,-2.35],[0.75,0.18,0.5],[0.98,0.97,0.92]); box([2.75,0.7,-2.35],[0.75,0.18,0.5],[0.98,0.97,0.92])
  box([2.25,0.67,-1.25],[2.02,0.07,1.5],[0.34,0.6,0.52]); box([3.55,0.34,-2],[0.55,0.68,0.55],[0.65,0.49,0.32])
  box([-2.8,0.5,2.55],[2.2,1,0.8],[0.41,0.58,0.47]); box([-2.8,1.03,2.55],[2.25,0.08,0.85],[0.92,0.91,0.85])
  box([2.5,0.8,2.4],[1.8,1.6,0.5],[0.63,0.47,0.3])
  const project = newProject('Sample apartment'), sceneId = crypto.randomUUID(), assetId = crypto.randomUUID()
  project.notes = 'An illustrative, locally generated sample for learning the viewer and editor. This is not a scanned property.'
  const geometry: GeometryData = { positions: new Float32Array(positions), colors: new Float32Array(colors), indices: new Uint32Array(indices) }
  project.scenes.push({ id: sceneId, geometryId: assetId, name: 'Sample cutaway', source: 'sample', kind: 'mesh', transform: IDENTITY_TRANSFORM(), vertexCount: positions.length / 3, triangleCount: indices.length / 3, capturedAt: project.createdAt, durationMs: 0, status: 'saved', warnings: ['Illustrative sample — not reconstructed from a real house.'] })
  project.rooms.push({ id: crypto.randomUUID(), sceneId, name: 'Living & kitchen', floor: 0, polygon: [[-4,0,-3],[0,0,-3],[0,0,3],[-4,0,3]], height: 2.7, provenance: 'manual' }, { id: crypto.randomUUID(), sceneId, name: 'Bedroom', floor: 0, polygon: [[0,0,-3],[4,0,-3],[4,0,3],[0,0,3]], height: 2.7, provenance: 'manual' })
  project.annotations.push({ id: crypto.randomUUID(), sceneId, position: [-2.65,0.95,-1.7], label: 'A place to unwind', note: 'Try orbiting the model, taking a measurement, or changing the cutaway height.' })
  return { project, assets: [{ id: assetId, projectId: project.id, kind: 'geometry', blob: encodeGeometry(geometry) }] }
}
