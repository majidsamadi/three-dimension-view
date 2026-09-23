/** Canonical model coordinates: right-handed, Y up, metres. No cloud identity is invented. */
export type Vec3 = [number, number, number]
export interface Bounds { min: Vec3; max: Vec3 }
export interface Transform { position: Vec3; rotation: Vec3; scale: number }
export type CaptureSource = 'arkit-mesh' | 'arcore-depth' | 'webxr-depth' | 'roomplan' | 'import' | 'sample'
export interface GeometryData {
  positions: Float32Array
  colors: Float32Array
  indices: Uint32Array
}
export interface SceneRecord {
  id: string; name: string; geometryId: string; source: CaptureSource
  kind: 'mesh' | 'points'; transform: Transform; crop?: Bounds
  vertexCount: number; triangleCount: number; capturedAt: string; durationMs: number
  status: 'review' | 'saved'; warnings: string[]
}
export interface Annotation { id: string; sceneId: string; position: Vec3; label: string; note: string }
export interface Measurement { id: string; sceneId: string; a: Vec3; b: Vec3; label: string }
export interface RoomRecord {
  id: string; sceneId: string; name: string; floor: number
  /** Points are in the owning scene's local coordinates. */
  polygon: Vec3[]; height: number; provenance: 'manual' | 'roomplan'
}
export interface PhotoRecord { id: string; assetId: string; name: string; caption: string; capturedAt: string; panorama: boolean }
export interface Project {
  schemaVersion: 1; id: string; revision: number; name: string; location: string; notes: string
  createdAt: string; updatedAt: string; favorite: boolean
  scenes: SceneRecord[]; annotations: Annotation[]; measurements: Measurement[]; rooms: RoomRecord[]; photos: PhotoRecord[]
}
export interface AssetRecord { id: string; projectId: string; kind: 'geometry' | 'photo'; blob: Blob }
export interface RenderScene { scene: SceneRecord; geometry: GeometryData }
export interface Settings {
  theme: 'system' | 'light' | 'dark'; units: 'm' | 'ft'; quality: 'balanced' | 'detail'
  grid: boolean; reduceMotion: boolean; onboardingDone: boolean
}
export const DEFAULT_SETTINGS: Settings = { theme: 'system', units: 'm', quality: 'balanced', grid: true, reduceMotion: false, onboardingDone: false }
export const IDENTITY_TRANSFORM = (): Transform => ({ position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 })
export const LIMITS = { vertices: 500_000, indices: 3_000_000, assetBytes: 64 * 1024 * 1024, archiveBytes: 256 * 1024 * 1024, manifestBytes: 2 * 1024 * 1024, scenes: 64, photos: 128 } as const
export const SOURCE_LABELS: Record<CaptureSource, string> = {
  'arkit-mesh': 'iPhone LiDAR mesh', 'arcore-depth': 'Android depth scan', 'webxr-depth': 'Browser depth scan',
  roomplan: 'Apple RoomPlan layout', import: 'Imported model', sample: 'Illustrative sample',
}
export class AppError extends Error {
  constructor(message: string, public code = 'APP_ERROR') { super(message); this.name = 'AppError' }
}
export function newProject(name: string, location = ''): Project {
  const now = new Date().toISOString()
  return { schemaVersion: 1, id: crypto.randomUUID(), revision: 1, name: name.trim(), location: location.trim(), notes: '', createdAt: now, updatedAt: now, favorite: false, scenes: [], annotations: [], measurements: [], rooms: [], photos: [] }
}
