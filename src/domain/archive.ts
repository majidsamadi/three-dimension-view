import { z } from 'zod'
import { AppError, LIMITS, type AssetRecord, type Project } from './types'
import { validateProject } from './validation'
import { decodeGeometry } from './geometry'

const text = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true })
const PLAIN_MAGIC = 'W3DV0001', ENCRYPTED_MAGIC = 'W3DE0001', ITERATIONS = 310_000
const descriptorSchema = z.object({ id: z.string().uuid(), kind: z.enum(['geometry', 'photo']), type: z.string().max(100), bytes: z.number().int().positive().max(LIMITS.assetBytes), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
const manifestSchema = z.object({ format: z.literal('wisestay.project.v1'), project: z.unknown(), assets: z.array(descriptorSchema).max(LIMITS.scenes + LIMITS.photos) }).strict()
async function digest(bytes: ArrayBuffer): Promise<string> { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('') }
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', text.encode(password).buffer, 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt.slice().buffer, iterations: ITERATIONS, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

/** A bounded, non-executable binary container; no ZIP expansion and no external resource URLs. */
export async function createArchive(project: Project, assets: AssetRecord[], password = ''): Promise<Blob> {
  const clean = validateProject(project), ids = [...clean.scenes.map(s => s.geometryId), ...clean.photos.map(p => p.assetId)]
  const selected = ids.map(id => { const a = assets.find(v => v.id === id && v.projectId === clean.id); if (!a) throw new AppError('A required project asset is missing.', 'MISSING_ASSET'); return a })
  if (selected.some(a => a.blob.size > LIMITS.assetBytes) || selected.reduce((n, a) => n + a.blob.size, 0) > LIMITS.archiveBytes - LIMITS.manifestBytes) throw new AppError('This project exceeds the portable file size limit.', 'ARCHIVE_LIMIT')
  const descriptors = []
  for (const a of selected) descriptors.push({ id: a.id, kind: a.kind, type: a.blob.type, bytes: a.blob.size, sha256: await digest(await a.blob.arrayBuffer()) })
  const manifest = text.encode(JSON.stringify({ format: 'wisestay.project.v1', project: clean, assets: descriptors }))
  if (manifest.length > LIMITS.manifestBytes) throw new AppError('Project metadata is too large.', 'ARCHIVE_LIMIT')
  const header = new Uint8Array(12); header.set(text.encode(PLAIN_MAGIC)); new DataView(header.buffer).setUint32(8, manifest.length, true)
  const plain = new Blob([header.buffer, manifest.buffer, ...selected.map(a => a.blob)], { type: 'application/vnd.wisestay.project' })
  if (!password) return plain
  if (password.length < 12 || password.length > 1024) throw new AppError('Use a passphrase of 12–1,024 characters.', 'WEAK_PASSPHRASE')
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12))
  const encryptedHeader = new Uint8Array(40); encryptedHeader.set(text.encode(ENCRYPTED_MAGIC)); encryptedHeader.set(salt, 8); encryptedHeader.set(iv, 24); new DataView(encryptedHeader.buffer).setUint32(36, ITERATIONS, true)
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv.buffer, additionalData: encryptedHeader.buffer }, await deriveKey(password, salt), await plain.arrayBuffer())
  return new Blob([encryptedHeader.buffer, cipher], { type: 'application/vnd.wisestay.project' })
}

export async function archiveIsEncrypted(blob: Blob): Promise<boolean> { return blob.size >= 8 && decoder.decode(await blob.slice(0, 8).arrayBuffer()) === ENCRYPTED_MAGIC }
export async function readArchive(blob: Blob, password = ''): Promise<{ project: Project; assets: AssetRecord[] }> {
  if (blob.size < 12 || blob.size > LIMITS.archiveBytes) throw new AppError('The project file is invalid or larger than 256 MB.', 'ARCHIVE_LIMIT')
  let buffer = await blob.arrayBuffer()
  if (decoder.decode(buffer.slice(0, 8)) === ENCRYPTED_MAGIC) {
    if (!password) throw new AppError('Enter the passphrase used to protect this project.', 'PASSPHRASE_REQUIRED')
    if (buffer.byteLength < 56 || new DataView(buffer).getUint32(36, true) !== ITERATIONS || password.length > 1024) throw new AppError('Unsupported encrypted project format.', 'INVALID_ARCHIVE')
    const header = buffer.slice(0, 40)
    try { buffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buffer.slice(24, 36), additionalData: header }, await deriveKey(password, new Uint8Array(buffer.slice(8, 24))), buffer.slice(40)) }
    catch { throw new AppError('The passphrase is incorrect or the encrypted file is damaged.', 'DECRYPT_FAILED') }
  }
  if (buffer.byteLength < 12 || decoder.decode(buffer.slice(0, 8)) !== PLAIN_MAGIC) throw new AppError('This is not a supported Three Dimension View project.', 'INVALID_ARCHIVE')
  const metadataSize = new DataView(buffer).getUint32(8, true)
  if (metadataSize < 2 || metadataSize > LIMITS.manifestBytes || 12 + metadataSize > buffer.byteLength) throw new AppError('Invalid project metadata length.', 'INVALID_ARCHIVE')
  let manifest: z.infer<typeof manifestSchema>
  try { manifest = manifestSchema.parse(JSON.parse(decoder.decode(buffer.slice(12, 12 + metadataSize)))) }
  catch { throw new AppError('The project metadata is damaged or unsupported.', 'INVALID_ARCHIVE') }
  const project = validateProject(manifest.project), expected = [...project.scenes.map(s => s.geometryId), ...project.photos.map(p => p.assetId)]
  if (manifest.assets.length !== expected.length || new Set(manifest.assets.map(a => a.id)).size !== expected.length || expected.some(id => !manifest.assets.some(a => a.id === id))) throw new AppError('The project asset manifest does not match its contents.', 'INVALID_ARCHIVE')
  let offset = 12 + metadataSize
  const assets: AssetRecord[] = []
  for (const a of manifest.assets) {
    if (offset + a.bytes > buffer.byteLength) throw new AppError('The project file is incomplete.', 'INVALID_ARCHIVE')
    const bytes = buffer.slice(offset, offset + a.bytes); offset += a.bytes
    if (await digest(bytes) !== a.sha256) throw new AppError('An asset checksum failed. The project was not imported.', 'CHECKSUM_FAILED')
    const blob = new Blob([bytes], { type: a.type })
    if (a.kind === 'geometry') {
      const data = await decodeGeometry(blob), scene = project.scenes.find(s => s.geometryId === a.id)
      if (!scene || scene.vertexCount !== data.positions.length / 3 || scene.triangleCount !== data.indices.length / 3 || scene.kind !== (data.indices.length ? 'mesh' : 'points')) throw new AppError('Scan metadata does not match its geometry.', 'INVALID_ARCHIVE')
    } else {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(a.type) || !project.photos.some(p => p.assetId === a.id)) throw new AppError('Unsupported photo type or reference in project.', 'INVALID_ARCHIVE')
    }
    assets.push({ id: a.id, projectId: project.id, kind: a.kind, blob })
  }
  if (offset !== buffer.byteLength) throw new AppError('The project contains unexpected trailing data.', 'INVALID_ARCHIVE')
  return { project, assets }
}

/** Imports create a copy; they never overwrite an existing project or another scene's assets. */
export function remapImportedProject(project: Project, assets: AssetRecord[]): { project: Project; assets: AssetRecord[] } {
  const copy = structuredClone(project), ids = new Map<string, string>()
  const remap = (old: string) => { if (!ids.has(old)) ids.set(old, crypto.randomUUID()); return ids.get(old)! }
  copy.id = remap(copy.id); copy.revision = 1; copy.updatedAt = new Date().toISOString()
  for (const s of copy.scenes) { s.id = remap(s.id); s.geometryId = remap(s.geometryId) }
  for (const item of [...copy.annotations, ...copy.measurements, ...copy.rooms]) { item.id = remap(item.id); item.sceneId = remap(item.sceneId) }
  for (const p of copy.photos) { p.id = remap(p.id); p.assetId = remap(p.assetId) }
  return { project: validateProject(copy), assets: assets.map(a => ({ ...a, id: remap(a.id), projectId: copy.id })) }
}
