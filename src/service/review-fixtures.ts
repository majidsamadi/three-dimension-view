import { FakeHomeScannerApi, syntheticEnvelope } from './home-scanner-fake'
import { createMemoryPendingUploadStore } from './pending-upload-store'
import { descriptorFor, type ServicePublishComposition, type ServiceUploadComposition } from './compositions'

/**
 * Review-fixture compositions for `/review-fixtures/service-upload` and `/review-fixtures/service-publish`.
 *
 * Status: component-tested (synthetic data only). Prototype / synthetic / not connected: every
 * call goes to the in-memory `FakeHomeScannerApi`; nothing leaves the browser.
 */
/** A minimal synthetic GLB (header + JSON chunk, no buffers). Built in code; no binary asset ships. */
export function buildSyntheticGlb(label = 'synthetic-review-fixture'): Uint8Array {
  let json = JSON.stringify({ asset: { version: '2.0', generator: label }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: label }] })
  while (json.length % 4) json += ' '
  const chunk = new TextEncoder().encode(json)
  const out = new Uint8Array(12 + 8 + chunk.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, out.length, true)
  view.setUint32(12, chunk.length, true)
  view.setUint32(16, 0x4e4f534a, true)
  out.set(chunk, 20)
  return out
}

export const FIXTURE_PROJECT_ID = 'synthetic-review-fixture'

export function createFixtureUploadComposition(fake = new FakeHomeScannerApi()): ServiceUploadComposition & { fake: FakeHomeScannerApi } {
  return {
    mode: 'synthetic-fixture',
    fake,
    api: fake,
    store: createMemoryPendingUploadStore(),
    putComponent: fake.putComponent,
    properties: [{ reference: 'PROP-VIRTUAL-1', label: 'Synthetic virtual property', propertyType: 'VIRTUAL' }],
    fixtureProjectId: FIXTURE_PROJECT_ID,
    async readProject(projectId) {
      return projectId === FIXTURE_PROJECT_ID ? { id: FIXTURE_PROJECT_ID, name: 'Synthetic unit box', sceneCount: 1, photoCount: 0 } : undefined
    },
    async prepare() {
      const base = syntheticEnvelope([])
      return { components: [await descriptorFor('main', buildSyntheticGlb())], bounds_m: base.bounds_m, scale_claim: base.scale_claim, unobserved_regions: base.unobserved_regions }
    },
  }
}

export function createFixturePublishComposition(fake = new FakeHomeScannerApi()): ServicePublishComposition & { fake: FakeHomeScannerApi } {
  const sceneId = fake.seedScene({ versions: [{ review_state: 'approved' }, { review_state: 'draft' }], published_version: '1' })
  return { mode: 'synthetic-fixture', fake, api: fake, fixtureSceneId: sceneId }
}

