import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { AppError, type AssetRecord, type Project, type Settings, DEFAULT_SETTINGS, LIMITS } from '@/domain/types'
import { validateProject } from '@/domain/validation'

interface WorkspaceDB extends DBSchema {
  projects: { key: string; value: Project }
  assets: { key: string; value: AssetRecord; indexes: { 'by-project': string } }
  settings: { key: string; value: Settings }
}
let database: Promise<IDBPDatabase<WorkspaceDB>> | undefined
export function db(): Promise<IDBPDatabase<WorkspaceDB>> {
  if (!database) database = openDB<WorkspaceDB>('wisestay-three-dimension-view', 1, {
    upgrade(database) {
      database.createObjectStore('projects', { keyPath: 'id' })
      database.createObjectStore('assets', { keyPath: 'id' }).createIndex('by-project', 'projectId')
      database.createObjectStore('settings')
    },
    blocked() { window.dispatchEvent(new CustomEvent('workspace-storage-blocked')) },
    blocking() { database?.then(connection => connection.close()); database = undefined },
    terminated() { database = undefined },
  }).catch(error => { database = undefined; throw error })
  return database
}
function announce(id?: string): void {
  window.dispatchEvent(new CustomEvent('workspace-change', { detail: id }))
  if (typeof BroadcastChannel !== 'undefined') { const channel = new BroadcastChannel('three-dimension-view'); channel.postMessage({ type: 'changed', id }); channel.close() }
}
export const repository = {
  async list(): Promise<Project[]> { return (await (await db()).getAll('projects')).map(validateProject).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) },
  async get(id: string): Promise<Project | undefined> { const value = await (await db()).get('projects', id); return value ? validateProject(value) : undefined },
  async create(project: Project, assets: AssetRecord[] = []): Promise<Project> {
    const clean = validateProject(project), connection = await db(), tx = connection.transaction(['projects', 'assets'], 'readwrite')
    try {
      if (await tx.objectStore('projects').get(clean.id)) throw new AppError('A project with this ID already exists.', 'CONFLICT')
      const references = new Map<string, AssetRecord['kind']>([...clean.scenes.map(s => [s.geometryId, 'geometry'] as const), ...clean.photos.map(p => [p.assetId, 'photo'] as const)])
      if (assets.length !== references.size || new Set(assets.map(a => a.id)).size !== assets.length) throw new AppError('The project assets are incomplete or duplicated.', 'INVALID_ASSET')
      await tx.objectStore('projects').add(clean)
      for (const asset of assets) {
        if (asset.projectId !== clean.id || references.get(asset.id) !== asset.kind || !asset.blob || asset.blob.size < 1 || asset.blob.size > LIMITS.assetBytes) throw new AppError('Invalid asset ownership, type or size.', 'INVALID_ASSET')
        await tx.objectStore('assets').add(asset)
      }
      await tx.done; announce(clean.id); return clean
    } catch (error) { try { tx.abort() } catch { /* The failing request may already have aborted the transaction. */ } await tx.done.catch(() => undefined); throw error }
  },
  async save(project: Project, expectedRevision: number, assets: AssetRecord[] = []): Promise<Project> {
    const clean = validateProject(project), connection = await db(), tx = connection.transaction(['projects', 'assets'], 'readwrite')
    try {
      const previous = await tx.objectStore('projects').get(clean.id)
      if (!previous) throw new AppError('This project was removed in another window.', 'NOT_FOUND')
      if (previous.revision !== expectedRevision) throw new AppError('This project changed in another window. Reload it before saving; your changes have not overwritten the newer version.', 'CONFLICT')
      const next = { ...clean, revision: previous.revision + 1, updatedAt: new Date().toISOString() }
      const referenced = new Set([...next.scenes.map(s => s.geometryId), ...next.photos.map(p => p.assetId)])
      for (const asset of assets) {
        if (asset.projectId !== next.id || !referenced.has(asset.id) || !asset.blob || asset.blob.size < 1 || asset.blob.size > LIMITS.assetBytes) throw new AppError('Invalid asset ownership or reference.', 'INVALID_ASSET')
        const oldAsset = await tx.objectStore('assets').get(asset.id)
        if (oldAsset && oldAsset.projectId !== next.id) throw new AppError('An asset ID belongs to another project.', 'INVALID_ASSET')
        await tx.objectStore('assets').put(asset)
      }
      for (const id of referenced) {
        const asset = await tx.objectStore('assets').get(id)
        if (!asset) throw new AppError('A required scan or photo is missing. Restore a backup before saving.', 'MISSING_ASSET')
        const kind = next.scenes.some(s => s.geometryId === id) ? 'geometry' : 'photo'
        if (asset.projectId !== next.id || asset.kind !== kind) throw new AppError('A referenced asset belongs to a different project or has the wrong type.', 'INVALID_ASSET')
      }
      for (const asset of await tx.objectStore('assets').index('by-project').getAll(next.id)) if (!referenced.has(asset.id)) await tx.objectStore('assets').delete(asset.id)
      await tx.objectStore('projects').put(next); await tx.done; announce(next.id); return next
    } catch (error) { try { tx.abort() } catch { /* Preserve the original failure. */ } await tx.done.catch(() => undefined); throw error }
  },
  async asset(id: string, projectId: string): Promise<AssetRecord> {
    const asset = await (await db()).get('assets', id)
    if (!asset || asset.projectId !== projectId) throw new AppError('The scan data is unavailable for this project. Restore a project backup.', 'MISSING_ASSET')
    return asset
  },
  async assets(projectId: string): Promise<AssetRecord[]> { return (await db()).getAllFromIndex('assets', 'by-project', projectId) },
  async remove(id: string, expectedRevision: number): Promise<void> {
    const tx = (await db()).transaction(['projects', 'assets'], 'readwrite')
    try {
      const p = await tx.objectStore('projects').get(id)
      if (p && p.revision !== expectedRevision) throw new AppError('This project changed in another window. Reload before deleting it.', 'CONFLICT')
      for (const assetId of await tx.objectStore('assets').index('by-project').getAllKeys(id)) await tx.objectStore('assets').delete(assetId)
      await tx.objectStore('projects').delete(id); await tx.done; announce(id)
    } catch (error) { try { tx.abort() } catch { /* Already aborted. */ } await tx.done.catch(() => undefined); throw error }
  },
  async getSettings(): Promise<Settings> {
    const raw = await (await db()).get('settings', 'preferences')
    if (!raw) return { ...DEFAULT_SETTINGS }
    return {
      ...DEFAULT_SETTINGS,
      theme: ['system', 'light', 'dark'].includes(raw.theme) ? raw.theme : 'system',
      units: raw.units === 'ft' ? 'ft' : 'm', quality: raw.quality === 'detail' ? 'detail' : 'balanced',
      grid: typeof raw.grid === 'boolean' ? raw.grid : true,
      reduceMotion: raw.reduceMotion === true, onboardingDone: raw.onboardingDone === true,
    }
  },
  async saveSettings(settings: Settings): Promise<void> { await (await db()).put('settings', structuredClone(settings), 'preferences') },
}
