import { db } from '@/data/database'
import type { ComponentDescriptor } from './home-scanner-api'

/**
 * Persisted service upload so a reload resumes the original `upload_id` (HSA-05.2).
 * Presigned URLs are never persisted; they are reissued through H04 after a reload.
 */
export interface PendingServiceUpload {
  projectId: string
  captureId: string
  uploadId: string
  recordVersion: number
  expiresAt: string
  components: ComponentDescriptor[]
  /** Reused for every finalize attempt so a lost acknowledgement replays instead of re-finalizing. */
  finalizeKey: string
  createdAt: string
}

export interface PendingUploadStore {
  get(projectId: string): Promise<PendingServiceUpload | undefined>
  put(record: PendingServiceUpload): Promise<void>
  remove(projectId: string): Promise<void>
}

/** IndexedDB store `pending-service-uploads` in the existing workspace DB (additive, DB version 2). */
export const idbPendingUploadStore: PendingUploadStore = {
  async get(projectId) { return (await db()).get('pending-service-uploads', projectId) },
  async put(record) { await (await db()).put('pending-service-uploads', structuredClone(record)) },
  async remove(projectId) { await (await db()).delete('pending-service-uploads', projectId) },
}

export function createMemoryPendingUploadStore(): PendingUploadStore & { records: Map<string, PendingServiceUpload> } {
  const records = new Map<string, PendingServiceUpload>()
  return {
    records,
    async get(projectId) { const record = records.get(projectId); return record ? structuredClone(record) : undefined },
    async put(record) { records.set(record.projectId, structuredClone(record)) },
    async remove(projectId) { records.delete(projectId) },
  }
}
