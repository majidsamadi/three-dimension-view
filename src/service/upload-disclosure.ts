/**
 * HSA-05.1: what leaves the device before a service upload, what stays local, and retention.
 *
 * Status: component-tested (synthetic data only). Retention values are the Q08
 * DELEGATED-PROVISIONAL durations and are untested against a live service. HSA-05.3 cloud
 * processing is DISABLED (Q02) and is shown as a static "not offered" note.
 */
export interface DisclosureProject {
  name: string
  sceneCount: number
  photoCount: number
}

export interface DisclosureItem { category: string; detail: string }

export interface UploadDisclosure {
  leavesDevice: DisclosureItem[]
  staysLocal: DisclosureItem[]
  retention: string[]
  cloudProcessing: string
  captureQualification: string
}

/** Categories that may leave the device. Raw capture is never among them (Q02). */
export const LEAVING_CATEGORIES = ['processed_glb', 'asset_envelope'] as const

export function describeUploadDisclosure(project: DisclosureProject): UploadDisclosure {
  const sections = project.sceneCount === 1 ? '1 scanned section' : `${project.sceneCount} scanned sections`
  const photos = project.photoCount === 1 ? '1 photo' : `${project.photoCount} photos`
  return {
    leavesDevice: [
      { category: 'Processed 3D model (GLB)', detail: `One processed model built on this device from ${sections} of “${project.name}”.` },
      { category: 'Asset envelope', detail: 'Bounds, coordinate frame, scale claim, regions not observed, and the size and SHA-256 digest of each model file.' },
    ],
    staysLocal: [
      { category: 'Raw camera frames (RGB)', detail: 'Never uploaded.' },
      { category: 'Depth data', detail: 'Never uploaded.' },
      { category: 'Motion sensor (IMU) data', detail: 'Never uploaded.' },
      { category: 'Photos', detail: `${photos} stay on this device.` },
      { category: 'Notes, annotations and measurements', detail: 'Stay in the local project.' },
      { category: 'Other projects on this device', detail: 'Not read or sent.' },
    ],
    retention: [
      'Raw capture never leaves this device, so the service keeps none of it.',
      'An upload that is not finalised is deleted from service staging after 7 days.',
      'Model files that fail validation (quarantined) are deleted after 30 days.',
      'These durations are provisional (Q08) and have not been verified against a live service.',
    ],
    cloudProcessing: 'Cloud processing is not offered. The service checks the uploaded model; it does not refine or rebuild it (Q02).',
    captureQualification: 'Device capture is not qualified. The uploaded model is an unqualified local result, not a survey (Q04).',
  }
}
