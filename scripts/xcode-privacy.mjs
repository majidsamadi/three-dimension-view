/**
 * Register the privacy manifest in the actual application resource phase.
 * Capacitor's SPM shell has no PBXGroup named "Resources". xcode.addResourceFile
 * assumes that group exists, even when given a group UUID, and crashes. Work with
 * the parsed reference graph instead; never alter signing or unrelated resources.
 */
export function ensurePrivacyManifest(project) {
  const objects = project.hash?.project?.objects
  const app = project.getFirstProject().firstProject
  const targetId = app.targets?.[0]?.value
  const target = objects?.PBXNativeTarget?.[targetId]
  const group = objects?.PBXGroup?.[app.mainGroup]
  const phaseId = target?.buildPhases?.map(p => p.value).find(id => objects.PBXResourcesBuildPhase?.[id])
  const phase = objects?.PBXResourcesBuildPhase?.[phaseId]
  if (!group || !Array.isArray(group.children) || !phase || !Array.isArray(phase.files)) {
    throw new Error('The application group/resources phase is missing; no Xcode project changes were made.')
  }
  const references = objects.PBXFileReference ||= {}
  const buildFiles = objects.PBXBuildFile ||= {}
  const clean = value => typeof value === 'string' ? value.replace(/^"|"$/g, '') : ''
  const resourcePath = 'App/PrivacyInfo.xcprivacy'
  let referenceId = Object.keys(references).find(id => clean(references[id]?.path) === resourcePath)
  let changed = false
  if (!referenceId) {
    referenceId = project.generateUuid()
    references[referenceId] = { isa: 'PBXFileReference', lastKnownFileType: 'text.xml', name: '"PrivacyInfo.xcprivacy"', path: `"${resourcePath}"`, sourceTree: '"<group>"' }
    references[`${referenceId}_comment`] = 'PrivacyInfo.xcprivacy'
    changed = true
  }
  if (!group.children.some(child => child.value === referenceId)) {
    group.children.push({ value: referenceId, comment: 'PrivacyInfo.xcprivacy' })
    changed = true
  }
  if (!phase.files.some(file => buildFiles[file.value]?.fileRef === referenceId)) {
    const buildId = project.generateUuid()
    buildFiles[buildId] = { isa: 'PBXBuildFile', fileRef: referenceId, fileRef_comment: 'PrivacyInfo.xcprivacy' }
    buildFiles[`${buildId}_comment`] = 'PrivacyInfo.xcprivacy in Resources'
    phase.files.push({ value: buildId, comment: 'PrivacyInfo.xcprivacy in Resources' })
    changed = true
  }
  return changed
}
