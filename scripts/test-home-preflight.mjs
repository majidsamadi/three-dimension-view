import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(process.argv[2] || '.')
const out = await mkdtemp(join(tmpdir(), 'wisestay-home-preflight-'))
const localTsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc')
const tscCommand = existsSync(localTsc) ? process.execPath : 'tsc'
const tscArgs = existsSync(localTsc)
  ? [localTsc, '--target', 'ES2022', '--module', 'ES2022', '--moduleResolution', 'Bundler', '--strict', '--skipLibCheck', '--outDir', out, join(root, 'src/home/preflight.ts')]
  : ['--target', 'ES2022', '--module', 'ES2022', '--moduleResolution', 'Bundler', '--strict', '--skipLibCheck', '--outDir', out, join(root, 'src/home/preflight.ts')]

const compiled = spawnSync(tscCommand, tscArgs, { cwd: root, encoding: 'utf8' })
if (compiled.status !== 0) {
  process.stderr.write(compiled.stdout || '')
  process.stderr.write(compiled.stderr || '')
  process.exit(compiled.status || 1)
}

try {
  const modulePath = join(out, 'preflight.js')
  const m = await import(pathToFileURL(modulePath).href + '?t=' + Date.now())
  const local = { id: '11111111-1111-4111-8111-111111111111', revision: 7, name: 'Kitchen example', location: 'Local note only' }
  const intent = { action: 'scan', localProjectId: local.id }
  const caps = (overrides = {}) => ({
    capture: { state: 'unknown', detail: 'capture unknown' },
    viewing: { state: 'available', detail: 'viewer present' },
    measurement: { state: 'unqualified', detail: 'measurement UI only' },
    offline: { state: 'unknown', detail: 'offline not qualified' },
    cameraPermission: { state: 'unknown', detail: 'not requested' },
    storage: { state: 'unknown', detail: 'no threshold' },
    assets: { state: 'unknown', detail: 'not checked' },
    ...overrides,
  })
  const identity = userId => ({ state: 'available', userId, identityContract: 'fixture', detail: 'synthetic fact' })
  const propertyFacts = () => ({ state: 'available', detail: 'synthetic property facts', contexts: [
    { reference: 'prop-pending', name: 'Pending', kind: 'real', state: 'pending-review', detail: 'pending' },
    { reference: 'prop-research', name: 'Research', kind: 'virtual', state: 'virtual-research', detail: 'research' },
    { reference: 'prop-ready', name: 'Ready', kind: 'real', state: 'ready', detail: 'ready' },
  ] })
  const makeAdapters = overrides => ({
    identity: { async readCurrent() { return identity('user-a') } },
    properties: { async readForIntent() { return propertyFacts() } },
    capabilities: { async inspect() { return caps() } },
    ...overrides,
  })

  let checks = 0
  const check = (condition, message) => { assert.ok(condition, message); checks++ }

  const unmatched = new m.HomePreflightController(local, intent, makeAdapters({ properties: { async readForIntent() { return { state: 'unavailable', contexts: [], detail: 'missing adapter' } } } }))
  const unmatchedResult = await unmatched.refresh()
  check(unmatchedResult.localProject.name === 'Kitchen example', 'local project preserved')
  check(unmatchedResult.selectedPropertyRef === undefined, 'no property manufactured')
  check(unmatchedResult.intent.localProjectId === local.id, 'return intent preserved')

  const distinct = new m.HomePreflightController(local, intent, makeAdapters())
  const distinctResult = await distinct.refresh()
  check(distinctResult.propertyFacts.contexts.map(x => x.state).join(',') === 'pending-review,virtual-research,ready', 'property states remain distinct')
  check(distinct.selectProperty('prop-research').selectedPropertyRef === 'prop-research', 'virtual/research context remains selectable as a fact')
  check(distinct.snapshot().localProject.id === local.id, 'property switching does not replace local project')

  const capabilityInput = caps({
    capture: { state: 'unavailable', detail: 'unsupported camera/device fixture' },
    measurement: { state: 'unknown', detail: 'measurement unknown' },
    storage: { state: 'pressure', detail: 'storage pressure fixture' },
  })
  const separated = new m.HomePreflightController(local, intent, makeAdapters({ capabilities: { async inspect() { return capabilityInput } } }))
  const separatedResult = await separated.refresh()
  check(separatedResult.capabilities.capture.state === 'unavailable', 'unsupported capture preserved')
  check(separatedResult.capabilities.measurement.state === 'unknown', 'unknown measurement preserved')
  check(separatedResult.capabilities.storage.state === 'pressure', 'storage pressure preserved')
  check(separatedResult.capabilities.offline.state === 'unknown', 'offline state not promoted')

  const switched = distinct.invalidateAccountContext('account switched')
  check(switched.identity.state === 'unavailable', 'account switch clears external identity presentation')
  check(switched.propertyFacts.contexts.length === 0, 'account switch clears property presentation')
  check(switched.localProject.id === local.id && switched.intent.localProjectId === local.id, 'account switch preserves local project and intent')

  let resolveIdentity
  const delayedIdentity = new Promise(resolve => { resolveIdentity = resolve })
  const delayed = new m.HomePreflightController(local, intent, makeAdapters({ identity: { async readCurrent() { return delayedIdentity } } }))
  const pendingIdentity = delayed.refresh()
  delayed.invalidateAccountContext('new account context')
  resolveIdentity(identity('old-user'))
  await pendingIdentity
  check(delayed.snapshot().identity.userId === undefined, 'late old-account identity ignored')

  let resolveProperties
  const delayedProperties = new Promise(resolve => { resolveProperties = resolve })
  const lateProperty = new m.HomePreflightController(local, intent, makeAdapters({ properties: { async readForIntent() { return delayedProperties } } }))
  const pendingProperty = lateProperty.refresh()
  await Promise.resolve()
  lateProperty.replaceIntent({ action: 'scan', localProjectId: local.id, canonicalPropertyRef: 'prop-new' })
  resolveProperties(propertyFacts())
  await pendingProperty
  check(lateProperty.snapshot().intent.canonicalPropertyRef === 'prop-new', 'changed return intent retained')
  check(lateProperty.snapshot().propertyFacts.contexts.length === 0, 'late old property result ignored')

  const router = await readFile(join(root, 'src/router.ts'), 'utf8')
  const view = await readFile(join(root, 'src/views/HomePreflightView.vue'), 'utf8')
  const adaptersSource = await readFile(join(root, 'src/home/preflight-adapters.ts'), 'utf8')
  check(router.includes("path:'/projects/:id/scan'"), 'legacy scan route retained')
  check(router.includes("path:'/projects/:id/preflight'"), 'preflight route wired')
  check((view.match(/ disabled/g) || []).length >= 7, 'real actions remain disabled')
  check(!/PhoneScanner\.start|repository\.save|repository\.create|fetch\(|getUserMedia\(/.test(view), 'preflight view contains no capture/network/storage write call')
  check(adaptersSource.includes('unavailableIdentity') && adaptersSource.includes('unavailableProperties'), 'missing live adapters fail unavailable')
  check(!/fetch\(|localStorage|sessionStorage/.test(adaptersSource), 'default adapters do not add network or browser storage writes')

  process.stdout.write(JSON.stringify({ status: 'PASS', checks, localProject: local.name, route: '/projects/:id/preflight' }) + '\n')
} finally {
  await rm(out, { recursive: true, force: true })
}
