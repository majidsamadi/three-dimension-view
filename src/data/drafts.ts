import { openDB, type DBSchema } from 'idb'
import { z } from 'zod'
import { decodeGeometry } from '@/domain/geometry'
import type { CaptureSource } from '@/domain/types'
export interface ScanDraft { sessionId: string; projectId: string; geometry: Blob; source: CaptureSource; capturedAt: string; durationMs: number; warnings: string[] }
interface DraftDB extends DBSchema { captures: { key: string; value: ScanDraft; indexes: { project: string } } }
const connection = () => openDB<DraftDB>('wisestay-3d-capture-recovery', 1, { upgrade(db) { db.createObjectStore('captures', { keyPath: 'sessionId' }).createIndex('project', 'projectId') } })
const schema = z.object({ sessionId: z.string().uuid(), projectId: z.string().uuid(), source: z.enum(['arkit-mesh', 'arcore-depth', 'webxr-depth', 'roomplan', 'import', 'sample']), capturedAt: z.string().datetime(), durationMs: z.number().min(0).max(86400000), warnings: z.array(z.string().max(1000)).max(32) })
export const drafts = {
 async put(draft: ScanDraft): Promise<void> { schema.parse(draft); await decodeGeometry(draft.geometry); const db = await connection(); try { await db.put('captures', draft) } finally { db.close() } },
 async list(projectId: string): Promise<ScanDraft[]> { const db = await connection(); try { return await db.getAllFromIndex('captures', 'project', projectId) } finally { db.close() } },
 async remove(sessionId: string): Promise<void> { const db = await connection(); try { await db.delete('captures', sessionId) } finally { db.close() } },
 async removeProject(projectId: string): Promise<void> { const db = await connection(); try { const tx = db.transaction('captures', 'readwrite'); for (const key of await tx.store.index('project').getAllKeys(projectId)) await tx.store.delete(key); await tx.done } finally { db.close() } },
}
