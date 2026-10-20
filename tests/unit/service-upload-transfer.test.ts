import { describe, expect, it, vi } from 'vitest'
import { repository, db } from '@/data/database'
import { newProject } from '@/domain/types'
import { buildUploadSelection, descriptorFor, type PreparedUpload } from '@/service/compositions'
import { sha256Hex } from '@/service/digest'
import { FakeHomeScannerApi, syntheticEnvelope } from '@/service/home-scanner-fake'
import { createMemoryPendingUploadStore } from '@/service/pending-upload-store'
import { buildSyntheticGlb } from '@/service/review-fixtures'
import { describeUploadView } from '@/service/service-status'
import { UploadTransferController, type LocalComponent, type PutComponent } from '@/service/upload-transfer'

// Status: component-tested (synthetic data only) against FakeHomeScannerApi.
const PROPERTY = { reference: 'PROP-VIRTUAL-1', label: 'Synthetic virtual property', propertyType: 'VIRTUAL' as const }

async function components(...ids: string[]): Promise<LocalComponent[]> {
  return Promise.all(ids.map(id => descriptorFor(id, buildSyntheticGlb(`synthetic-${id}`))))
}

function prepared(parts: LocalComponent[]): PreparedUpload {
  const base = syntheticEnvelope([])
  return { components: parts, bounds_m: base.bounds_m, scale_claim: base.scale_claim, unobserved_regions: base.unobserved_regions }
}

function setup(options: { put?: (inner: PutComponent) => PutComponent; now?: () => number } = {}) {
  const fake = new FakeHomeScannerApi({ now: options.now })
  const store = createMemoryPendingUploadStore()
  const putComponent = options.put ? options.put(fake.putComponent) : fake.putComponent
  const make = () => new UploadTransferController('project-1', { api: fake, store, putComponent, now: options.now, wait: async () => undefined })
  return { fake, store, make }
}

const count = (fake: FakeHomeScannerApi, operation: string) => fake.calls.filter(call => call === operation).length

describe('HSA-05.2 resumable transfer and HSA-05.4 honest recovery', () => {
  it('HSA-05.2 resumes original upload_id after reload', async () => {
    let controller!: UploadTransferController
    let puts = 0
    const { fake, store, make } = setup({ put: inner => async (url, headers, bytes) => { const response = await inner(url, headers, bytes); if (++puts === 1) controller.pause(); return response } })
    controller = make()
    const parts = await components('a', 'b')
    await controller.start(buildUploadSelection({ projectId: 'project-1', property: PROPERTY, contentClass: 'synthetic', prepared: prepared(parts) }))
    const first = controller.snapshot()
    expect(first.state).toBe('paused')
    expect(first.components.map(item => item.state)).toEqual(['confirmed', 'pending'])
    expect(store.records.get('project-1')?.uploadId).toBe(first.uploadId)

    // Reload: a new controller with no in-memory state reattaches through H03.
    const reloaded = make()
    expect(await reloaded.restore()).toBe(true)
    expect(reloaded.snapshot()).toMatchObject({ state: 'paused', uploadId: first.uploadId, needsLocalBytes: true })
    await reloaded.resume(await components('a', 'b'))
    expect(reloaded.snapshot().state).toBe('validated')
    expect(reloaded.snapshot().uploadId).toBe(first.uploadId)
    expect(count(fake, 'admitUpload')).toBe(1)
    expect(count(fake, 'createCapture')).toBe(1)
    expect(fake.puts.filter(item => item.endsWith('/a'))).toHaveLength(1)
    expect(store.records.size).toBe(0)
  })

  it('HSA-05.2 lost ack reconciles via getUpload, no second admission', async () => {
    const { fake, make } = setup()
    fake.dropNextPutAck = true
    const controller = make()
    const states: string[] = []
    controller.subscribe(snapshot => states.push(snapshot.state))
    await controller.start(buildUploadSelection({ projectId: 'project-1', property: PROPERTY, contentClass: 'synthetic', prepared: prepared(await components('main')) }))
    expect(controller.snapshot().state).toBe('validated')
    expect(states).toContain('retrying')
    expect(count(fake, 'admitUpload')).toBe(1)
    // Storage already had the bytes: reconciliation confirmed them and no second PUT was sent.
    expect(fake.puts).toHaveLength(1)
    expect(count(fake, 'getUpload')).toBeGreaterThanOrEqual(2)
    expect(count(fake, 'finalizeUpload')).toBe(1)
  })

  it('HSA-05.2 url-expired reissues only missing components', async () => {
    let clock = Date.parse('2026-10-20T00:00:00Z')
    let puts = 0
    const { fake, make } = setup({
      now: () => clock,
      put: inner => async (url, headers, bytes) => { const response = await inner(url, headers, bytes); if (++puts === 1) clock += 901_000; return response },
    })
    const reissue = vi.spyOn(fake, 'reissueComponentUrls')
    const controller = make()
    const states: string[] = []
    controller.subscribe(snapshot => states.push(snapshot.state))
    await controller.start(buildUploadSelection({ projectId: 'project-1', property: PROPERTY, contentClass: 'synthetic', prepared: prepared(await components('a', 'b')) }))
    expect(states).toContain('url-expired')
    expect(reissue).toHaveBeenCalledTimes(1)
    expect(reissue.mock.calls[0][1]).toEqual({ component_ids: ['b'] })
    const urls = await reissue.mock.results[0].value
    expect(urls.components.map((item: { component_id: string }) => item.component_id)).toEqual(['b'])
    expect(controller.snapshot().state).toBe('validated')
    expect(fake.puts.filter(item => item.endsWith('/a'))).toHaveLength(1)
  })

  it('HSA-05.4 tampered digest → failed with reason, local original kept', async () => {
    const connection = await db()
    await connection.clear('projects')
    const project = newProject('Local original')
    await repository.create(project)
    const { fake, store, make } = setup()
    fake.scenario.tamperComponent = true
    const parts = await components('main')
    const before = await sha256Hex(parts[0].bytes)
    const controller = make()
    await controller.start(buildUploadSelection({ projectId: project.id, property: PROPERTY, contentClass: 'synthetic', prepared: prepared(parts) }))
    const snapshot = controller.snapshot()
    expect(snapshot.state).toBe('failed')
    expect(snapshot.reasons).toEqual(['digest_mismatch'])
    expect(snapshot.components).toEqual([{ component_id: 'main', state: 'failed', reason: 'digest_mismatch' }])
    expect(count(fake, 'finalizeUpload')).toBe(0)
    // The local bytes and the local project are untouched; the upload stays recorded so it can be cancelled.
    expect(await sha256Hex(parts[0].bytes)).toBe(before)
    expect(await repository.get(project.id)).toEqual(project)
    expect(store.records.has('project-1')).toBe(true)
    expect(describeUploadView({ loading: false, project: { sceneCount: 1 }, transfer: snapshot }).headline).toContain('Your local project is unchanged')
  })

  it('HSA-05.4 cancel', async () => {
    let controller!: UploadTransferController
    const { fake, store, make } = setup({ put: inner => async (url, headers, bytes) => { const response = await inner(url, headers, bytes); controller.pause(); return response } })
    controller = make()
    await controller.start(buildUploadSelection({ projectId: 'project-1', property: PROPERTY, contentClass: 'synthetic', prepared: prepared(await components('a', 'b')) }))
    const uploadId = controller.snapshot().uploadId!
    await controller.cancel()
    expect(controller.snapshot().state).toBe('cancelled')
    expect(store.records.size).toBe(0)
    expect((await fake.getUpload(uploadId)).state).toBe('cancelled')
    expect(count(fake, 'finalizeUpload')).toBe(0)
    // Cancelling again is a no-op.
    await controller.cancel()
    expect(count(fake, 'cancelUpload')).toBe(1)
  })

  it('HSA-05.4 quarantined distinct from failed', async () => {
    const { make } = setup()
    const notGlb = await descriptorFor('main', new TextEncoder().encode('synthetic bytes that are not a GLB'))
    const controller = make()
    await controller.start(buildUploadSelection({ projectId: 'project-1', property: PROPERTY, contentClass: 'synthetic', prepared: prepared([notGlb]) }))
    const quarantined = controller.snapshot()
    expect(quarantined.state).toBe('quarantined')
    expect(quarantined.reasons).toEqual(['glb_bad_magic'])
    expect(quarantined.result?.state).toBe('quarantined')
    const failed = { ...quarantined, state: 'failed' as const, reasons: ['digest_mismatch'] }
    const a = describeUploadView({ loading: false, project: { sceneCount: 1 }, transfer: quarantined })
    const b = describeUploadView({ loading: false, project: { sceneCount: 1 }, transfer: failed })
    expect(a.status).toBe('quarantined')
    expect(b.status).toBe('failed')
    expect(a.headline).not.toBe(b.headline)
  })
})
