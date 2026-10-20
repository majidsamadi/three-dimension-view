import { randomIdempotencyKey } from './home-scanner-http'
import {
  isServiceProblem,
  type AudienceProjection,
  type ContentClass,
  type ExcludedCategory,
  type HomeScannerApi,
  type PublishResult,
  type SceneDetail,
  type SceneVersionDetail,
  type WithdrawResult,
} from './home-scanner-api'

/**
 * HSA-06.1 publication review of the exact version and projection, HSA-06.2 backend-confirmed
 * outcome, HSA-06.3 replacement and withdrawal.
 *
 * Status: component-tested (synthetic data only). HSA-06.4 two-device delivery is not done.
 * A publication is shown as published only after an H12 response (or an H08 read) says so.
 */

export const WITHDRAWAL_TEXT = 'Blocks new viewers now; already-issued view links expire within 5 minutes.'
export const OCCUPIED_NOTE = 'Publication of occupied homes is disabled. Only synthetic content and permitted unoccupied references can be published (Q07).'
export const AUDIENCE_TEXT = 'Explicit grantees only: people the owner names. Not public and not listed.'

const EXCLUDED_LABELS: Record<ExcludedCategory, string> = {
  raw_capture: 'Raw capture (camera, depth and motion data)',
  diagnostics: 'Diagnostics',
  review_model: 'Review model',
  source_photos: 'Source photos',
  notes: 'Notes',
}
const CONTENT_CLASS_LABELS: Record<ContentClass, string> = {
  synthetic: 'Synthetic content',
  'permitted-unoccupied-reference': 'Permitted unoccupied reference',
  occupied: 'Occupied home',
}

export interface PublicationReview {
  sceneId: string
  version: string
  versionLabel: string
  reviewState: SceneVersionDetail['review_state']
  validation: SceneVersionDetail['state']
  projectionId: string | null
  projectionComponents: string[]
  excludedCategories: string[]
  audience: string
  contentClass: string
  occupiedNote: string
  /** The currently published version this one would replace, if any. */
  replaces: string | null
  alreadyPublished: boolean
  canApprove: boolean
  canPublish: boolean
  publishBlockedReason: string | null
  canWithdraw: boolean
  withdrawBlockedReason: string | null
  withdrawalText: string
}

export function describePublicationReview(scene: SceneDetail, version: SceneVersionDetail, projection?: AudienceProjection): PublicationReview {
  const contentClass = version.envelope.provenance.content_class
  const owner = scene.role === 'owner'
  const published = scene.publication.state === 'published' ? scene.publication.published_version : null
  const projectionMatches = Boolean(projection && projection.version === version.version && projection.scene_id === scene.scene_id)
  let blocked: string | null = null
  if (!owner) blocked = 'Only the scene owner can publish.'
  else if (scene.publication.state === 'withdrawn') blocked = 'This scene was withdrawn. It cannot be published again from here.'
  else if (contentClass === 'occupied') blocked = OCCUPIED_NOTE
  else if (version.state === 'quarantined') blocked = 'This version failed validation (quarantined) and cannot be published.'
  else if (version.review_state !== 'approved') blocked = 'Approve this exact version before publishing.'
  else if (!projectionMatches) blocked = 'The audience projection for this exact version has not been read.'
  else if (published === version.version) blocked = 'This exact version is already published.'
  return {
    sceneId: scene.scene_id,
    version: version.version,
    versionLabel: `Version ${version.version}`,
    reviewState: version.review_state,
    validation: version.state,
    projectionId: projectionMatches ? projection!.projection_id : null,
    projectionComponents: projectionMatches ? [...projection!.components] : [],
    excludedCategories: (projection?.excluded_categories || ['raw_capture', 'diagnostics', 'review_model', 'source_photos', 'notes']).map(item => EXCLUDED_LABELS[item]),
    audience: AUDIENCE_TEXT,
    contentClass: CONTENT_CLASS_LABELS[contentClass] || contentClass,
    occupiedNote: OCCUPIED_NOTE,
    replaces: published && published !== version.version ? published : null,
    alreadyPublished: published === version.version,
    canApprove: owner && version.state === 'validated' && ['draft', 'review_ready'].includes(version.review_state) && contentClass !== 'occupied',
    canPublish: blocked === null,
    publishBlockedReason: blocked,
    canWithdraw: owner && scene.publication.state === 'published',
    withdrawBlockedReason: !owner ? 'Only the scene owner can withdraw.' : scene.publication.state === 'published' ? null : 'Nothing is published, so there is nothing to withdraw.',
    withdrawalText: WITHDRAWAL_TEXT,
  }
}

export type PublicationStatus =
  | 'loading'
  | 'empty'
  | 'ready'
  | 'stale'
  | 'approving'
  | 'publishing'
  | 'published'
  | 'conflict'
  | 'denied'
  | 'offline'
  | 'withdrawing'
  | 'withdrawn'
  | 'not-found'
  | 'signed-out'
  | 'failed'

export interface PublicationSnapshot {
  status: PublicationStatus
  scene?: SceneDetail
  selected?: string
  versionDetail?: SceneVersionDetail
  projection?: AudienceProjection
  review?: PublicationReview
  problem?: { status: number; code: string }
  publishResult?: PublishResult
  withdrawResult?: WithdrawResult
}

function problemStatus(error: unknown): { status: PublicationStatus; problem: { status: number; code: string } } {
  if (!isServiceProblem(error)) return { status: 'offline', problem: { status: 0, code: 'network_unavailable' } }
  const problem = { status: error.status, code: error.code }
  if (error.status === 401) return { status: 'signed-out', problem }
  if (error.code === 'version_conflict') return { status: 'conflict', problem }
  if (error.status === 403) return { status: 'denied', problem }
  if (error.status === 503) return { status: 'offline', problem }
  if (error.status === 404) return { status: 'not-found', problem }
  if (error.code === 'resource_withdrawn') return { status: 'withdrawn', problem }
  return { status: 'failed', problem }
}

export class PublicationReviewController {
  private value: PublicationSnapshot = { status: 'loading' }
  private readonly listeners = new Set<(snapshot: PublicationSnapshot) => void>()
  private epoch = 0

  constructor(readonly sceneId: string, private readonly api: HomeScannerApi, private readonly keys: () => string = randomIdempotencyKey) {}

  snapshot(): PublicationSnapshot { return structuredClone(this.value) }

  subscribe(listener: (snapshot: PublicationSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private set(next: PublicationSnapshot): void {
    this.value = next
    const copy = this.snapshot()
    for (const listener of this.listeners) listener(copy)
  }

  private settled(scene: SceneDetail, detail?: SceneVersionDetail, projection?: AudienceProjection, extra: Partial<PublicationSnapshot> = {}): PublicationSnapshot {
    if (scene.publication.state === 'withdrawn') return { status: 'withdrawn', scene, ...extra }
    if (!detail) return { status: 'empty', scene, ...extra }
    const review = describePublicationReview(scene, detail, projection)
    const status: PublicationStatus = review.alreadyPublished ? 'published' : 'ready'
    return { status, scene, selected: detail.version, versionDetail: detail, projection, review, ...extra }
  }

  /**
   * H08, then H09 and H11 for the chosen version (default: newest validated). Reads are
   * epoch-guarded: an older response arriving after a newer one is ignored. While a re-read
   * runs over shown details the status is `stale`.
   */
  async load(version?: string): Promise<void> {
    const epoch = ++this.epoch
    const shown = this.value.scene
    this.set(shown ? { ...this.value, status: 'stale', problem: undefined } : { status: 'loading' })
    try {
      const scene = await this.api.getScene(this.sceneId)
      if (epoch !== this.epoch) return
      const validated = scene.versions.filter(item => item.state === 'validated')
      const chosen = version && scene.versions.some(item => item.version === version)
        ? version
        : validated.length ? validated[validated.length - 1].version : undefined
      if (!chosen || scene.publication.state === 'withdrawn') { this.set(this.settled(scene)); return }
      const detail = await this.api.getSceneVersion(this.sceneId, chosen)
      if (epoch !== this.epoch) return
      let projection: AudienceProjection | undefined
      if (scene.role === 'owner' && detail.review_state === 'approved') projection = await this.api.getAudienceProjection(this.sceneId, chosen)
      if (epoch !== this.epoch) return
      this.set(this.settled(scene, detail, projection))
    } catch (error) {
      if (epoch !== this.epoch) return
      const { status, problem } = problemStatus(error)
      this.set({ ...this.value, status, problem })
    }
  }

  /** H10 approve the exact selected version, then re-read. */
  async approve(): Promise<void> {
    const { scene, selected, review } = this.value
    if (!scene || !selected || !review?.canApprove) return
    const epoch = ++this.epoch
    this.set({ ...this.value, status: 'approving', problem: undefined })
    try {
      await this.api.reviewVersion(this.sceneId, selected, { decision: 'approved', review_inputs: {}, expected_version: scene.record_version }, { idempotencyKey: this.keys() })
      if (epoch !== this.epoch) return
      await this.load(selected)
    } catch (error) {
      if (epoch !== this.epoch) return
      this.set({ ...this.value, ...problemStatus(error) })
    }
  }

  /** H12. The outcome becomes `published` only from the backend response. */
  async publish(): Promise<void> {
    const { scene, selected, review } = this.value
    if (!scene || !selected || !review?.canPublish || !review.projectionId) return
    const epoch = ++this.epoch
    this.set({ ...this.value, status: 'publishing', problem: undefined })
    try {
      const result = await this.api.publish(this.sceneId, { version: selected, projection_id: review.projectionId, expected_version: scene.record_version }, { idempotencyKey: this.keys() })
      if (epoch !== this.epoch) return
      const superseded = result.superseded_version ? [...scene.publication.superseded_versions, result.superseded_version] : scene.publication.superseded_versions
      const next: SceneDetail = { ...scene, record_version: result.record_version, publication: { state: result.state, published_version: result.published_version, superseded_versions: superseded } }
      this.set(this.settled(next, this.value.versionDetail, this.value.projection, { publishResult: result }))
    } catch (error) {
      if (epoch !== this.epoch) return
      this.set({ ...this.value, ...problemStatus(error) })
    }
  }

  /** H13 withdrawal. */
  async withdraw(reason: string): Promise<void> {
    const { scene, review } = this.value
    const text = reason.trim()
    if (!scene || !review?.canWithdraw || !text) return
    const epoch = ++this.epoch
    this.set({ ...this.value, status: 'withdrawing', problem: undefined })
    try {
      const result = await this.api.withdraw(this.sceneId, { expected_version: scene.record_version, reason: text }, { idempotencyKey: this.keys() })
      if (epoch !== this.epoch) return
      const next: SceneDetail = { ...scene, publication: { ...scene.publication, state: 'withdrawn' } }
      this.set({ status: 'withdrawn', scene: next, withdrawResult: result })
    } catch (error) {
      if (epoch !== this.epoch) return
      this.set({ ...this.value, ...problemStatus(error) })
    }
  }
}
