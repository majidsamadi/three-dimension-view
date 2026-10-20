import { openDB } from 'idb'
import { describe, expect, it } from 'vitest'
import { WORKSPACE_DB_NAME, WORKSPACE_DB_VERSION, db, repository } from '@/data/database'
import { DEFAULT_SETTINGS, newProject } from '@/domain/types'
import { idbPendingUploadStore, type PendingServiceUpload } from '@/service/pending-upload-store'

describe('pending service upload store', () => {
  it('HSA-05.2 IndexedDB additive store migration keeps existing projects', async () => {
    // A version 1 workspace exactly as the legacy app created it (LEGACY_PRESERVATION_REGISTER).
    const legacy = await openDB(WORKSPACE_DB_NAME, 1, {
      upgrade(database) {
        database.createObjectStore('projects', { keyPath: 'id' })
        database.createObjectStore('assets', { keyPath: 'id' }).createIndex('by-project', 'projectId')
        database.createObjectStore('settings')
      },
    })
    const project = newProject('Legacy kitchen', 'Free-text location')
    await legacy.put('projects', project)
    await legacy.put('settings', { ...DEFAULT_SETTINGS, units: 'ft' }, 'preferences')
    legacy.close()

    const upgraded = await db()
    expect(WORKSPACE_DB_VERSION).toBe(2)
    expect(upgraded.version).toBe(2)
    expect([...upgraded.objectStoreNames].sort()).toEqual(['assets', 'pending-service-uploads', 'projects', 'settings'])
    expect(upgraded.transaction('assets').store.indexNames.contains('by-project')).toBe(true)
    expect(await repository.get(project.id)).toEqual(project)
    expect((await repository.getSettings()).units).toBe('ft')

    const record: PendingServiceUpload = {
      projectId: project.id, captureId: 'cap_01HZYSYNTH0000000000000001', uploadId: 'upl_01HZYSYNTH0000000000000001', recordVersion: 1,
      expiresAt: '2026-10-27T00:00:00Z', components: [], finalizeKey: 'hsa-finalize-key-1', createdAt: '2026-10-20T00:00:00Z',
    }
    await idbPendingUploadStore.put(record)
    expect(await idbPendingUploadStore.get(project.id)).toEqual(record)
    // The pending record never changes the project record.
    expect(await repository.get(project.id)).toEqual(project)
    await idbPendingUploadStore.remove(project.id)
    expect(await idbPendingUploadStore.get(project.id)).toBeUndefined()
    expect(await repository.get(project.id)).toEqual(project)
  })
})
