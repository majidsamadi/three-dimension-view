import { describe, expect, it, vi } from 'vitest'
import { FakeHomeScannerApi } from '@/service/home-scanner-fake'
import type { PublishResult } from '@/service/home-scanner-api'
import { OCCUPIED_NOTE, PublicationReviewController, WITHDRAWAL_TEXT, describePublicationReview } from '@/service/publication-review'
import { describePublishView } from '@/service/service-status'

// Status: component-tested (synthetic data only) against FakeHomeScannerApi. HSA-06.4 is not done.
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('HSA-06 publication review', () => {
  it('HSA-06.2 published only after backend confirms', async () => {
    const fake = new FakeHomeScannerApi()
    const sceneId = fake.seedScene({ versions: [{ review_state: 'approved' }] })
    const controller = new PublicationReviewController(sceneId, fake)
    await controller.load()
    expect(controller.snapshot().status).toBe('ready')
    expect(controller.snapshot().review).toMatchObject({ version: '1', canPublish: true, audience: expect.stringMatching(/^Explicit grantees only/) })

    const gate = deferred<void>()
    const original = FakeHomeScannerApi.prototype.publish.bind(fake)
    vi.spyOn(fake, 'publish').mockImplementation(async (...args): Promise<PublishResult> => { await gate.promise; return original(...args) })
    const pending = controller.publish()
    expect(controller.snapshot().status).toBe('publishing')
    expect(describePublishView(controller.snapshot()).headline).toMatch(/not published until the service confirms/)
    expect(controller.snapshot().scene?.publication.state).toBe('unpublished')
    gate.resolve()
    await pending
    expect(controller.snapshot().status).toBe('published')
    expect(controller.snapshot().publishResult).toMatchObject({ state: 'published', published_version: '1', superseded_version: null })
  })

  it('HSA-06.2 version_conflict → conflict state', async () => {
    const fake = new FakeHomeScannerApi({ scenario: { conflictOnPublish: true } })
    const sceneId = fake.seedScene({ versions: [{ review_state: 'approved' }] })
    const controller = new PublicationReviewController(sceneId, fake)
    await controller.load()
    await controller.publish()
    const conflict = controller.snapshot()
    expect(conflict.status).toBe('conflict')
    expect(conflict.problem).toEqual({ status: 409, code: 'version_conflict' })
    expect(conflict.scene?.publication.state).toBe('unpublished')
    expect(describePublishView(conflict).headline).toMatch(/Re-read it/)
    // Reload, then publish succeeds against the current record version.
    fake.scenario.conflictOnPublish = false
    await controller.load()
    await controller.publish()
    expect(controller.snapshot().status).toBe('published')
  })

  it('HSA-06.3 replacement supersedes the published version', async () => {
    const fake = new FakeHomeScannerApi()
    const sceneId = fake.seedScene({ versions: [{ review_state: 'approved' }, { review_state: 'draft' }], published_version: '1' })
    const controller = new PublicationReviewController(sceneId, fake)
    await controller.load('2')
    expect(controller.snapshot().review).toMatchObject({ version: '2', replaces: '1', canApprove: true, canPublish: false })
    await controller.approve()
    expect(controller.snapshot().review).toMatchObject({ reviewState: 'approved', canPublish: true, replaces: '1' })
    await controller.publish()
    expect(controller.snapshot().publishResult).toMatchObject({ published_version: '2', superseded_version: '1' })
    expect((await fake.getScene(sceneId)).publication.superseded_versions).toEqual(['1'])
  })

  it('HSA-06.3 withdrawal text', async () => {
    expect(WITHDRAWAL_TEXT).toBe('Blocks new viewers now; already-issued view links expire within 5 minutes.')
    const fake = new FakeHomeScannerApi()
    const sceneId = fake.seedScene({ versions: [{ review_state: 'approved' }], published_version: '1' })
    const controller = new PublicationReviewController(sceneId, fake)
    await controller.load()
    expect(controller.snapshot().review?.withdrawalText).toBe(WITHDRAWAL_TEXT)
    await controller.withdraw('   ')
    expect(fake.calls).not.toContain('withdraw')
    await controller.withdraw('Synthetic withdrawal')
    const snapshot = controller.snapshot()
    expect(snapshot.status).toBe('withdrawn')
    expect(snapshot.withdrawResult?.state).toBe('withdrawn')
    expect(describePublishView(snapshot).headline).toMatch(/expire within 5 minutes/)
    fake.actor = 'USER-A'
    await expect(fake.createViewGrant(sceneId, {})).rejects.toMatchObject({ status: 410, code: 'resource_withdrawn' })
  })

  it('HSA-06.1 occupied disabled', async () => {
    const fake = new FakeHomeScannerApi()
    const sceneId = fake.seedScene({ content_class: 'occupied', versions: [{ review_state: 'approved' }] })
    const scene = await fake.getScene(sceneId)
    const version = await fake.getSceneVersion(sceneId, '1')
    const projection = await fake.getAudienceProjection(sceneId, '1')
    const review = describePublicationReview(scene, version, projection)
    expect(review.canPublish).toBe(false)
    expect(review.publishBlockedReason).toBe(OCCUPIED_NOTE)
    expect(review.contentClass).toBe('Occupied home')
    expect(review.excludedCategories).toContain('Raw capture (camera, depth and motion data)')
    await expect(fake.publish(sceneId, { version: '1', projection_id: projection.projection_id, expected_version: scene.record_version })).rejects.toMatchObject({ status: 422, code: 'occupied_home_publication_disabled' })
  })

  it('HSA-06.1 a non-owner (grantee) cannot publish', async () => {
    const fake = new FakeHomeScannerApi()
    const sceneId = fake.seedScene({ versions: [{ review_state: 'approved' }], published_version: '1' })
    await fake.grant(sceneId, { grantee_user_id: 'USER-B', expires_at: new Date(Date.now() + 86_400_000).toISOString() }, { idempotencyKey: 'idem-grant-0001' })
    fake.actor = 'USER-B'
    const controller = new PublicationReviewController(sceneId, fake)
    await controller.load()
    expect(controller.snapshot().review).toMatchObject({ canPublish: false, publishBlockedReason: 'Only the scene owner can publish.', canWithdraw: false })
  })
})
