import { z } from 'zod'
import { AppError, LIMITS, type GeometryData, type Project } from './types'

const finite = z.number().finite().min(-100_000).max(100_000)
const vector = z.tuple([finite, finite, finite])
const uuid = z.string().uuid()
const bounds = z.object({ min: vector, max: vector }).strict().refine(v => v.min.every((x, i) => x <= v.max[i]), 'Crop minimum must not exceed its maximum.')
const transform = z.object({ position: vector, rotation: vector, scale: z.number().finite().min(0.0001).max(1000) }).strict()
const scene = z.object({
  id: uuid, name: z.string().min(1).max(100), geometryId: uuid,
  source: z.enum(['arkit-mesh', 'arcore-depth', 'webxr-depth', 'roomplan', 'import', 'sample']),
  kind: z.enum(['mesh', 'points']), transform, crop: bounds.optional(),
  vertexCount: z.number().int().min(1).max(LIMITS.vertices), triangleCount: z.number().int().min(0).max(LIMITS.indices / 3),
  capturedAt: z.string().datetime(), durationMs: z.number().finite().min(0).max(86_400_000),
  status: z.enum(['review', 'saved']), warnings: z.array(z.string().max(500)).max(20),
}).strict()
export const projectSchema = z.object({
  schemaVersion: z.literal(1), id: uuid, revision: z.number().int().positive(), name: z.string().trim().min(1).max(100),
  location: z.string().max(200), notes: z.string().max(5000), createdAt: z.string().datetime(), updatedAt: z.string().datetime(), favorite: z.boolean(),
  scenes: z.array(scene).max(LIMITS.scenes),
  annotations: z.array(z.object({ id: uuid, sceneId: uuid, position: vector, label: z.string().min(1).max(100), note: z.string().max(1000) }).strict()).max(500),
  measurements: z.array(z.object({ id: uuid, sceneId: uuid, a: vector, b: vector, label: z.string().max(100) }).strict()).max(500),
  rooms: z.array(z.object({ id: uuid, sceneId: uuid, name: z.string().min(1).max(100), floor: z.number().int().min(-20).max(300), polygon: z.array(vector).min(3).max(100), height: z.number().finite().min(0.1).max(100), provenance: z.enum(['manual', 'roomplan']) }).strict()).max(200),
  photos: z.array(z.object({ id: uuid, assetId: uuid, name: z.string().min(1).max(100), caption: z.string().max(1000), capturedAt: z.string().datetime(), panorama: z.boolean() }).strict()).max(LIMITS.photos),
}).strict()

export function validateProject(value: unknown): Project {
  const parsed = projectSchema.safeParse(value)
  if (!parsed.success) throw new AppError(`Invalid project: ${parsed.error.issues[0]?.message || 'schema mismatch'}`, 'INVALID_PROJECT')
  const p = parsed.data
  for (const records of [p.scenes, p.annotations, p.measurements, p.rooms, p.photos]) {
    if (new Set(records.map(r => r.id)).size !== records.length) throw new AppError('The project contains duplicate record IDs.', 'INVALID_PROJECT')
  }
  const scenes = new Set(p.scenes.map(s => s.id))
  if ([...p.annotations, ...p.measurements, ...p.rooms].some(v => !scenes.has(v.sceneId))) throw new AppError('A project item refers to a missing scan.', 'INVALID_PROJECT')
  const assets = [...p.scenes.map(s => s.geometryId), ...p.photos.map(s => s.assetId)]
  if (new Set(assets).size !== assets.length) throw new AppError('The project contains duplicate asset references.', 'INVALID_PROJECT')
  return p
}

export function validateGeometry(g: GeometryData): void {
  if (!(g.positions instanceof Float32Array) || !(g.colors instanceof Float32Array) || !(g.indices instanceof Uint32Array)) throw new AppError('Invalid geometry buffer types.', 'INVALID_GEOMETRY')
  const count = g.positions.length / 3
  if (!Number.isInteger(count) || count < 1 || count > LIMITS.vertices) throw new AppError(`A model must contain 1–${LIMITS.vertices.toLocaleString()} vertices.`, 'MODEL_LIMIT')
  if (g.colors.length !== 0 && g.colors.length !== g.positions.length) throw new AppError('Vertex colours do not match the geometry.', 'INVALID_GEOMETRY')
  if (g.indices.length % 3 !== 0 || g.indices.length > LIMITS.indices) throw new AppError('Invalid or oversized triangle list.', 'MODEL_LIMIT')
  for (const n of g.positions) if (!Number.isFinite(n) || Math.abs(n) > 100_000) throw new AppError('The model contains invalid coordinates.', 'INVALID_GEOMETRY')
  for (const n of g.colors) if (!Number.isFinite(n) || n < 0 || n > 1) throw new AppError('Vertex colours must be finite values between zero and one.', 'INVALID_GEOMETRY')
  for (const index of g.indices) if (index >= count) throw new AppError('A triangle refers to a missing vertex.', 'INVALID_GEOMETRY')
}

export function safeFilename(value: string): string {
  return value.normalize('NFKC').replace(/[^a-zA-Z0-9._ -]/g, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 80) || 'space'
}
export function errorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') return 'Your device storage is full. Export a backup and remove unneeded projects before retrying.'
  if (error instanceof DOMException && error.name === 'NotAllowedError') return 'Permission was not granted. Enable camera/AR access in your device or browser settings, then try again.'
  return error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String(error.message) : 'Something went wrong. Your existing saved projects have not been removed.'
}
