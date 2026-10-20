import { randomIdempotencyKey } from './home-scanner-http'
import {
  isServiceProblem,
  type AssetEnvelope,
  type ComponentDescriptor,
  type ComponentUrl,
  type CreateCaptureRequest,
  type FinalizeResult,
  type HomeScannerApi,
  type UploadStatus,
} from './home-scanner-api'
import type { PendingServiceUpload, PendingUploadStore } from './pending-upload-store'

/**
 * Resumable service upload state machine (HSA-05.2 resumable transfer, HSA-05.4 honest recovery).
 *
 * Status: component-tested (synthetic data only). The original `upload_id` is persisted and a
 * lost acknowledgement is resolved through H03 `getUpload` reconciliation, never through a second
 * admission. Local project data is never modified or deleted by this controller.
 */
export type UploadTransferState =
  | 'selecting'
  | 'admitted'
  | 'transferring'
  | 'paused'
  | 'retrying'
  | 'url-expired'
  | 'confirmed'
  | 'finalizing'
  | 'validated'
  | 'quarantined'
  | 'failed'
  | 'cancelled'

export interface LocalComponent { descriptor: ComponentDescriptor; bytes: Uint8Array }
export interface UploadSelection { capture: CreateCaptureRequest; envelope: AssetEnvelope; components: LocalComponent[] }
export type PutComponent = (url: string, headers: Record<string, string>, bytes: Uint8Array) => Promise<{ status: number }>

export interface TransferProblem { status: number; code: string }
export interface TransferComponentView { component_id: string; state: 'pending' | 'confirmed' | 'failed'; reason: string | null }

export interface UploadTransferSnapshot {
  state: UploadTransferState
  uploadId?: string
  captureId?: string
  components: TransferComponentView[]
  /** Service reasons (quarantine codes, component failure reasons, or a local reason). */
  reasons: string[]
  /** Last service problem, kept so the view can name offline / denied / conflict / expired. */
  problem?: TransferProblem
  result?: FinalizeResult
  /** True when bytes must be supplied again (after a reload) before the transfer can continue. */
  needsLocalBytes: boolean
}

export interface UploadTransferDeps {
  api: HomeScannerApi
  store: PendingUploadStore
  putComponent: PutComponent
  keys?: () => string
  now?: () => number
  wait?: (ms: number) => Promise<void>
  maxAttempts?: number
}

const CANCEL_BLOCKED: UploadTransferState[] = ['selecting', 'finalizing', 'validated', 'quarantined', 'cancelled']

function asProblem(error: unknown): TransferProblem | undefined {
  return isServiceProblem(error) ? { status: error.status, code: error.code } : undefined
}

/** Raised inside the loop when a newer operation (cancel, pause, a new run) supersedes it. */
class Superseded extends Error {}

export class UploadTransferController {
  private value: UploadTransferSnapshot = { state: 'selecting', components: [], reasons: [], needsLocalBytes: false }
  private readonly listeners = new Set<(snapshot: UploadTransferSnapshot) => void>()
  private pending?: PendingServiceUpload
  private bytes = new Map<string, Uint8Array>()
  private tickets = new Map<string, ComponentUrl>()
  private attempts = new Map<string, number>()
  private run = 0
  private pauseRequested = false
  private readonly keys: () => string
  private readonly now: () => number
  private readonly wait: (ms: number) => Promise<void>
  private readonly maxAttempts: number

  constructor(readonly projectId: string, private readonly deps: UploadTransferDeps) {
    this.keys = deps.keys || randomIdempotencyKey
    this.now = deps.now || (() => Date.now())
    this.wait = deps.wait || (ms => new Promise(done => setTimeout(done, ms)))
    this.maxAttempts = deps.maxAttempts ?? 3
  }

  snapshot(): UploadTransferSnapshot {
    return structuredClone(this.value)
  }

  subscribe(listener: (snapshot: UploadTransferSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private set(patch: Partial<UploadTransferSnapshot>): void {
    this.value = { ...this.value, ...patch }
    const copy = this.snapshot()
    for (const listener of this.listeners) listener(copy)
  }

  private check(run: number): void {
    if (run !== this.run) throw new Superseded()
  }

  private async persist(): Promise<void> {
    if (this.pending) await this.deps.store.put(this.pending)
  }

  private async forget(): Promise<void> {
    this.pending = undefined
    await this.deps.store.remove(this.projectId)
  }

  /** After a reload: reattach to the persisted upload through H03, never through a new admission. */
  async restore(): Promise<boolean> {
    const record = await this.deps.store.get(this.projectId)
    if (!record) return false
    const run = ++this.run
    this.pending = record
    this.set({ state: 'paused', uploadId: record.uploadId, captureId: record.captureId, reasons: [], problem: undefined, needsLocalBytes: true, components: record.components.map(item => ({ component_id: item.component_id, state: 'pending', reason: null })) })
    try {
      const status = await this.deps.api.getUpload(record.uploadId)
      this.check(run)
      this.apply(status)
      if (status.state === 'cancelled') { await this.forget(); this.set({ state: 'cancelled', needsLocalBytes: false }) }
      else if (this.value.components.some(item => item.state === 'failed')) this.fail(this.value.components.filter(item => item.reason).map(item => item.reason!))
    } catch (error) {
      if (error instanceof Superseded) return true
      await this.handle(error, run)
    }
    return true
  }

  /** Start a new upload: H01 capture, H02 admission, then transfer and finalize. */
  async start(selection: UploadSelection): Promise<void> {
    if (this.value.state !== 'selecting') throw new Error('An upload is already in progress for this project.')
    const run = ++this.run
    this.pauseRequested = false
    this.bytes = new Map(selection.components.map(item => [item.descriptor.component_id, item.bytes]))
    this.set({ problem: undefined, reasons: [] })
    try {
      const capture = await this.deps.api.createCapture(selection.capture, { idempotencyKey: this.keys() })
      this.check(run)
      const descriptors = selection.components.map(item => item.descriptor)
      const session = await this.deps.api.admitUpload(capture.capture_id, { envelope: selection.envelope, components: descriptors }, { idempotencyKey: this.keys() })
      this.check(run)
      this.pending = {
        projectId: this.projectId, captureId: capture.capture_id, uploadId: session.upload_id, recordVersion: session.record_version,
        expiresAt: session.expires_at, components: descriptors, finalizeKey: this.keys(), createdAt: new Date(this.now()).toISOString(),
      }
      await this.persist()
      this.tickets = new Map(session.components.map(item => [item.component_id, item]))
      this.set({ state: 'admitted', uploadId: session.upload_id, captureId: capture.capture_id, needsLocalBytes: false, components: session.components.map(item => ({ component_id: item.component_id, state: 'pending', reason: null })) })
    } catch (error) {
      if (error instanceof Superseded) return
      // Nothing was admitted: return to selection with the problem named.
      if (!this.pending) { this.set({ state: 'selecting', problem: asProblem(error) || { status: 0, code: 'network_unavailable' } }); return }
      await this.handle(error, run)
      return
    }
    await this.transfer(run)
  }

  /** Continue a paused or restored upload. After a reload the same local bytes must be supplied again. */
  async resume(components?: LocalComponent[]): Promise<void> {
    if (!this.pending || !['paused', 'retrying', 'url-expired'].includes(this.value.state)) return
    if (components) {
      const expected = new Map(this.pending.components.map(item => [item.component_id, item.sha256]))
      if (components.some(item => expected.get(item.descriptor.component_id) !== item.descriptor.sha256)) {
        this.set({ reasons: ['local_source_changed'] })
        return
      }
      this.bytes = new Map(components.map(item => [item.descriptor.component_id, item.bytes]))
    }
    const missing = this.value.components.filter(item => item.state !== 'confirmed' && !this.bytes.has(item.component_id))
    if (missing.length) { this.set({ needsLocalBytes: true }); return }
    const run = ++this.run
    this.pauseRequested = false
    this.attempts.clear()
    this.set({ needsLocalBytes: false, problem: undefined, reasons: [] })
    await this.transfer(run)
  }

  /** Pause between component PUTs. Already-sent bytes are kept by the service until expiry. */
  pause(): void {
    if (['admitted', 'transferring', 'retrying', 'url-expired'].includes(this.value.state)) this.pauseRequested = true
  }

  /** H05 cancel. The local project and its geometry are kept. */
  async cancel(): Promise<void> {
    // A failed upload that is still persisted (for example a digest mismatch) can be cancelled to release it.
    if (!this.pending || CANCEL_BLOCKED.includes(this.value.state)) return
    const run = ++this.run
    try {
      await this.deps.api.cancelUpload(this.pending.uploadId, { expected_version: this.pending.recordVersion }, { idempotencyKey: this.keys() })
      this.check(run)
      await this.forget()
      this.set({ state: 'cancelled', problem: undefined, needsLocalBytes: false })
    } catch (error) {
      if (error instanceof Superseded) return
      await this.handle(error, run)
    }
  }

  private apply(status: UploadStatus): void {
    if (this.pending) {
      this.pending.recordVersion = status.record_version
      this.pending.expiresAt = status.expires_at
    }
    this.set({ components: status.components.map(item => ({ component_id: item.component_id, state: item.state, reason: item.reason })) })
  }

  private async reconcile(run: number): Promise<UploadStatus> {
    const status = await this.deps.api.getUpload(this.pending!.uploadId)
    this.check(run)
    this.apply(status)
    await this.persist()
    return status
  }

  private async reissue(run: number, ids: string[]): Promise<void> {
    this.set({ state: 'url-expired' })
    const urls = await this.deps.api.reissueComponentUrls(this.pending!.uploadId, { component_ids: ids }, { idempotencyKey: this.keys() })
    this.check(run)
    for (const item of urls.components) this.tickets.set(item.component_id, item)
    this.set({ state: 'transferring' })
  }

  private fail(reasons: string[], problem?: TransferProblem): void {
    this.set({ state: 'failed', reasons, problem })
  }

  private async transfer(run: number): Promise<void> {
    try {
      this.set({ state: 'transferring' })
      for (;;) {
        const status = await this.reconcile(run)
        if (status.state === 'cancelled') { await this.forget(); this.set({ state: 'cancelled' }); return }
        const failed = status.components.filter(item => item.state === 'failed')
        // HSA-05.4: a digest or size mismatch is a failure with a reason; the local original is kept.
        if (failed.length) { this.fail(failed.map(item => item.reason || 'component_failed')); return }
        const missing = status.components.filter(item => item.state !== 'confirmed').map(item => item.component_id)
        if (!missing.length) break
        // Pause only after reconciling, so the shown part states match what the service holds.
        if (this.pauseRequested) { this.set({ state: 'paused' }); return }
        const expired = missing.filter(id => { const ticket = this.tickets.get(id); return !ticket || Date.parse(ticket.url_expires_at) <= this.now() })
        if (expired.length) { await this.reissue(run, expired); continue }
        const id = missing[0]
        const ticket = this.tickets.get(id)!
        const bytes = this.bytes.get(id)
        if (!bytes) { this.set({ state: 'paused', needsLocalBytes: true }); return }
        let outcome: 'sent' | 'url-expired' | 'error'
        try {
          const response = await this.deps.putComponent(ticket.put_url, ticket.put_headers, bytes)
          outcome = response.status >= 200 && response.status < 300 ? 'sent' : response.status === 403 ? 'url-expired' : 'error'
        } catch {
          outcome = 'error'
        }
        this.check(run)
        if (outcome === 'url-expired') { this.tickets.delete(id); this.set({ state: 'url-expired' }); continue }
        if (outcome === 'error') {
          // The acknowledgement may be lost even though storage has the bytes: reconcile first (loop top).
          const attempts = (this.attempts.get(id) || 0) + 1
          this.attempts.set(id, attempts)
          if (attempts >= this.maxAttempts) {
            const status = await this.reconcile(run)
            if (status.components.find(item => item.component_id === id)?.state === 'confirmed') continue
            this.set({ state: 'paused', problem: { status: 0, code: 'network_unavailable' } })
            return
          }
          this.set({ state: 'retrying' })
          await this.wait(500 * attempts)
          this.check(run)
          continue
        }
        this.set({ state: 'transferring' })
      }
      this.set({ state: 'confirmed' })
      await this.finalize(run)
    } catch (error) {
      if (error instanceof Superseded) return
      await this.handle(error, run)
    }
  }

  private async finalize(run: number): Promise<void> {
    const pending = this.pending!
    this.set({ state: 'finalizing' })
    for (let attempt = 1; ; attempt++) {
      try {
        const result = await this.deps.api.finalizeUpload(pending.uploadId, { expected_version: pending.recordVersion }, { idempotencyKey: pending.finalizeKey })
        this.check(run)
        await this.forget()
        this.set({ state: result.state, result, reasons: [...result.validation.reasons], problem: undefined })
        return
      } catch (error) {
        if (error instanceof Superseded) throw error
        if (isServiceProblem(error)) {
          if (error.code === 'already_finalized' && error.sceneId && error.version) {
            const version = await this.deps.api.getSceneVersion(error.sceneId, error.version)
            this.check(run)
            await this.forget()
            this.set({ state: version.state, result: { scene_id: error.sceneId, version: error.version, state: version.state, validation: { reasons: [] }, envelope_sha256: '' }, problem: undefined })
            return
          }
          if (error.code === 'upload_incomplete') { await this.transfer(run); return }
          throw error
        }
        // Lost acknowledgement: retry with the same key so the service replays the stored result.
        if (attempt >= this.maxAttempts) { this.set({ state: 'paused', problem: { status: 0, code: 'network_unavailable' } }); return }
        await this.wait(500 * attempt)
        this.check(run)
      }
    }
  }

  private async handle(error: unknown, run: number): Promise<void> {
    if (run !== this.run) return
    const problem = asProblem(error)
    if (!problem) { this.set({ state: 'paused', problem: { status: 0, code: 'network_unavailable' } }); return }
    if (problem.code === 'upload_expired' || problem.code === 'not_found') {
      await this.forget()
      this.fail([problem.code], problem)
      return
    }
    if (problem.code === 'component_digest_mismatch' || problem.code === 'component_size_mismatch') {
      const components = isServiceProblem(error) ? error.components || [] : []
      this.set({ components: components.map(item => ({ component_id: item.component_id, state: item.state === 'confirmed' ? 'confirmed' : 'failed', reason: item.reason })) })
      this.fail(components.filter(item => item.reason).map(item => item.reason!).concat(components.length ? [] : [problem.code]), problem)
      return
    }
    if (problem.code === 'version_conflict' && this.pending && isServiceProblem(error) && error.currentVersion !== undefined) {
      this.pending.recordVersion = error.currentVersion
      await this.persist()
    }
    // Offline, denied, conflict and other recoverable problems pause with the problem named.
    this.set({ state: 'paused', problem })
  }
}
