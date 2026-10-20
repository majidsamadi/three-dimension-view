import type { PublicationSnapshot } from './publication-review'
import type { UploadTransferSnapshot } from './upload-transfer'

/**
 * One headline per service-view state. The headline is the only text inside each view's
 * `role="status"` live region (lesson from A-R4); details live in non-live elements.
 *
 * Status: component-tested (synthetic data only). Device capture stays unqualified (Q04):
 * no headline claims accuracy or capture qualification.
 */
export type UploadViewStatus =
  | 'loading'
  | 'not-found'
  | 'empty'
  | 'ready'
  | 'offline'
  | 'denied'
  | 'signed-out'
  | 'conflict'
  | 'transferring'
  | 'paused'
  | 'retrying'
  | 'url-expired'
  | 'finalizing'
  | 'validated'
  | 'quarantined'
  | 'expired'
  | 'failed'
  | 'cancelled'

export interface ServiceHeadline<S extends string> { status: S; headline: string }

const PROBLEM_TEXT: Record<string, string> = {
  property_not_usable: 'the property could not be used',
  occupied_home_publication_disabled: 'occupied homes cannot be uploaded for publication',
  validation_failed: 'the upload description was rejected',
  limit_exceeded: 'the model is too large',
  invalid_request: 'the request was rejected',
  not_found: 'the upload is not visible to this account',
  local_source_changed: 'the local model changed since the upload started',
  digest_mismatch: 'a stored part did not match its digest',
  size_mismatch: 'a stored part did not match its size',
}
const reasonText = (codes: string[]): string => codes.map(code => PROBLEM_TEXT[code] || code).join('; ')

export function describeUploadView(input: { loading: boolean; project?: { sceneCount: number }; transfer: UploadTransferSnapshot }): ServiceHeadline<UploadViewStatus> {
  const { transfer } = input
  if (input.loading) return { status: 'loading', headline: 'Reading the local project and any upload in progress.' }
  if (!input.project && transfer.state === 'selecting') return { status: 'not-found', headline: 'This local project is not on this device.' }
  const problem = transfer.problem
  const paused = transfer.state === 'paused' || transfer.state === 'selecting'
  if (problem && paused) {
    const kept = transfer.state === 'paused' ? ' The same upload is kept and can resume.' : ' Nothing was uploaded.'
    if (problem.status === 503 || problem.status === 0) return { status: 'offline', headline: `The Home Scanner service is not connected or the network is unavailable.${kept}` }
    if (problem.status === 401) return { status: 'signed-out', headline: `You are signed out of WiseStay. Sign in to continue.${kept}` }
    if (problem.status === 403) return { status: 'denied', headline: `This account is not allowed to do this.${kept}` }
    if (problem.status === 409) return { status: 'conflict', headline: `The upload record changed elsewhere. Re-check before continuing.${kept}` }
    if (transfer.state === 'selecting') return { status: 'failed', headline: `The service refused the upload: ${reasonText([problem.code])}. Nothing was uploaded.` }
  }
  switch (transfer.state) {
    case 'selecting':
      if (input.project && input.project.sceneCount === 0) return { status: 'empty', headline: 'This project has no scanned sections to upload.' }
      return { status: 'ready', headline: 'Ready to prepare an upload. Nothing has left this device.' }
    case 'admitted':
    case 'transferring': {
      const done = transfer.components.filter(item => item.state === 'confirmed').length
      return { status: 'transferring', headline: `Uploading the processed model: ${done} of ${transfer.components.length} parts confirmed.` }
    }
    case 'paused':
      return { status: 'paused', headline: transfer.needsLocalBytes ? 'Upload paused. Resume rebuilds the same model on this device and continues the same upload.' : 'Upload paused. Resume continues the same upload.' }
    case 'retrying':
      return { status: 'retrying', headline: 'A part did not reach the service. Checking what arrived, then retrying.' }
    case 'url-expired':
      return { status: 'url-expired', headline: 'Upload links expired. Requesting new links only for parts not yet confirmed.' }
    case 'confirmed':
    case 'finalizing':
      return { status: 'finalizing', headline: 'All parts arrived. Waiting for the service to check the model.' }
    case 'validated':
      return { status: 'validated', headline: `The service validated version ${transfer.result?.version ?? ''}. It is not published.` }
    case 'quarantined':
      return { status: 'quarantined', headline: 'The service quarantined this upload: it failed validation and is not available to anyone.' }
    case 'failed':
      if (transfer.reasons.includes('upload_expired')) return { status: 'expired', headline: 'This upload expired. Your local project is unchanged; start a new upload.' }
      return { status: 'failed', headline: `Upload failed: ${reasonText(transfer.reasons)}. Your local project is unchanged.` }
    case 'cancelled':
      return { status: 'cancelled', headline: 'Upload cancelled. Your local project is unchanged.' }
  }
}

export function describePublishView(snapshot: PublicationSnapshot): ServiceHeadline<PublicationSnapshot['status']> {
  const version = snapshot.selected ? `version ${snapshot.selected}` : 'this version'
  switch (snapshot.status) {
    case 'loading': return { status: 'loading', headline: 'Reading the scene from the Home Scanner service.' }
    case 'empty': return { status: 'empty', headline: 'This scene has no validated version to review.' }
    case 'ready':
      return { status: 'ready', headline: snapshot.review?.reviewState === 'approved' ? `Approved ${version} is ready to publish. It is not published.` : `${version[0].toUpperCase()}${version.slice(1)} is not approved yet. It is not published.` }
    case 'stale': return { status: 'stale', headline: 'Re-reading the scene. The details shown may be out of date.' }
    case 'approving': return { status: 'approving', headline: `Recording approval of ${version}.` }
    case 'publishing': return { status: 'publishing', headline: `Publishing ${version}. It is not published until the service confirms.` }
    case 'published': return { status: 'published', headline: `The service confirmed ${version} is published to explicit grantees.` }
    case 'conflict': return { status: 'conflict', headline: 'The scene changed elsewhere. Re-read it before trying again; nothing was published.' }
    case 'denied': return { status: 'denied', headline: 'Only the scene owner can do this. Nothing was changed.' }
    case 'offline': return { status: 'offline', headline: 'The Home Scanner service is not connected. Nothing was published or changed.' }
    case 'withdrawing': return { status: 'withdrawing', headline: 'Withdrawing the publication.' }
    case 'withdrawn': return { status: 'withdrawn', headline: 'This scene is withdrawn. New viewers are blocked; issued view links expire within 5 minutes.' }
    case 'not-found': return { status: 'not-found', headline: 'This scene was not found or is not visible to this account.' }
    case 'signed-out': return { status: 'signed-out', headline: 'You are signed out of WiseStay. Sign in to read this scene; nothing was changed.' }
    case 'failed': return { status: 'failed', headline: `The service refused the request (${snapshot.problem?.code ?? 'unknown'}). Nothing was published.` }
  }
}
