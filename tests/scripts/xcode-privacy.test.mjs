import test from 'node:test'
import assert from 'node:assert/strict'
import xcode from 'xcode'
import { ensurePrivacyManifest } from '../../scripts/xcode-privacy.mjs'
function fixture() {
  const project = xcode.project('unused.pbxproj')
  project.hash = { project: { objects: {
    PBXProject: { PROJECT: { isa: 'PBXProject', mainGroup: 'MAIN', targets: [{ value: 'TARGET' }] } },
    PBXNativeTarget: { TARGET: { isa: 'PBXNativeTarget', buildPhases: [{ value: 'PHASE' }], buildConfigurationList: 'CONFIG' } },
    PBXGroup: { MAIN: { isa: 'PBXGroup', children: [], sourceTree: '"<group>"' } },
    PBXResourcesBuildPhase: { PHASE: { isa: 'PBXResourcesBuildPhase', files: [{ value: 'EXISTING' }] } },
    PBXFileReference: {}, PBXBuildFile: { EXISTING: { isa: 'PBXBuildFile', fileRef: 'OTHER' } },
    XCBuildConfiguration: { CONFIG: { buildSettings: { DEVELOPMENT_TEAM: 'KEEP_TEAM', CODE_SIGN_IDENTITY: 'KEEP_IDENTITY' } } },
  } } }
  return project
}
test('adds the privacy resource without a named Resources group', () => {
  const project = fixture()
  assert.equal(ensurePrivacyManifest(project), true)
  const objects = project.hash.project.objects
  const files = objects.PBXResourcesBuildPhase.PHASE.files
  assert.equal(files.length, 2)
  const ref = objects.PBXFileReference[objects.PBXBuildFile[files[1].value].fileRef]
  assert.equal(ref.path, '"App/PrivacyInfo.xcprivacy"')
  assert.equal(objects.PBXGroup.MAIN.children.length, 1)
  assert.deepEqual(objects.XCBuildConfiguration.CONFIG.buildSettings, { DEVELOPMENT_TEAM: 'KEEP_TEAM', CODE_SIGN_IDENTITY: 'KEEP_IDENTITY' })
  assert.equal(objects.PBXBuildFile.EXISTING.fileRef, 'OTHER')
})
test('registration is idempotent and does not duplicate resources', () => {
  const project = fixture()
  ensurePrivacyManifest(project)
  const original = JSON.stringify(project.hash)
  assert.equal(ensurePrivacyManifest(project), false)
  assert.equal(JSON.stringify(project.hash), original)
})
test('repairs a file reference missing from the target resource phase', () => {
  const project = fixture()
  ensurePrivacyManifest(project)
  const objects = project.hash.project.objects
  objects.PBXResourcesBuildPhase.PHASE.files.pop()
  assert.equal(ensurePrivacyManifest(project), true)
  assert.equal(objects.PBXGroup.MAIN.children.length, 1)
  assert.equal(objects.PBXResourcesBuildPhase.PHASE.files.length, 2)
})
test('rejects a missing application phase before changing the graph', () => {
  const project = fixture()
  project.hash.project.objects.PBXNativeTarget.TARGET.buildPhases = []
  const original = JSON.stringify(project.hash)
  assert.throws(() => ensurePrivacyManifest(project), /resources phase is missing/)
  assert.equal(JSON.stringify(project.hash), original)
})
