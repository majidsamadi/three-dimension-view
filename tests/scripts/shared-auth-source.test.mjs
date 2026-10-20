import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import {
  APPLICATIONS,
  CONTRACT,
  WebSession,
} from '../../src/vendor/account-centre/web-session.mjs'

const manifest = JSON.parse(fs.readFileSync('src/vendor/account-centre/shared-auth-source.json', 'utf8'))
const hash = (path) => createHash('sha256').update(fs.readFileSync(path)).digest('hex')

test('vendored canonical WebSession bytes stay pinned and register Home Scanner on its own origin only', () => {
  assert.equal(manifest.canonical_repository, 'majidsamadi/wisestay-user-management-backend')
  assert.equal(manifest.canonical_commit, '5b085956d3435145fe80922a53d4d304aa19f97f')
  assert.equal(manifest.canonical_tree, '505755337e039cfdb42a351e201173dead7b1c97')
  assert.equal(hash('src/vendor/account-centre/web-session.mjs'), '153b77584d8d10606ba183c64bb780770a0e256a85a6546343f6b08a2c975bac')
  assert.equal(hash('src/vendor/account-centre/web-session.d.mts'), '9b70034885b0fc8c93699b26eb53a2cea68ecf622b313c0acd2e1c3e7027b9d3')
  assert.equal(CONTRACT, 'wisestay.web-session.v1')
  assert.deepEqual(Object.keys(APPLICATIONS), [
    'owner', 'tenant', 'iot', 'service-manager', 'ota', 'admin', 'resvanta', 'main-mobile', 'iot-mobile',
    'home-scanner', 'object-scanner', 'composer', 'finder',
  ])
  assert.equal(APPLICATIONS['home-scanner'], 'https://home-scanner.wizestay.com')
  assert.equal(Object.hasOwn(APPLICATIONS, 'home'), false)
  assert.equal(new WebSession({ application: 'home-scanner', origin: 'https://home-scanner.wizestay.com' }).enabled, true)
  assert.equal(new WebSession({ application: 'home-scanner', origin: 'https://composer.wizestay.com' }).enabled, false)
  assert.equal(new WebSession({ application: 'home-scanner', origin: 'http://localhost:5173' }).enabled, false)
  assert.equal(manifest.runtime_binding, 'same_origin_bff')
  assert.equal(manifest.registration, 'registered')
})

test('the canonical session refuses sibling 3D services for Home Scanner', async () => {
  const session = new WebSession({
    application: 'home-scanner',
    origin: APPLICATIONS['home-scanner'],
    fetch: async () => { throw new Error('No request expected for a refused service.') },
    navigate: () => { throw new Error('No navigation expected.') },
  })
  session.receipt = {
    contract: CONTRACT,
    csrf: 'c'.repeat(64),
    authenticated: true,
    user_id: '2a8459c4-77ef-5220-9a43-d16155fcf510',
    identity_contract: 'wisestay.identity.v1',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  }
  session.csrf = 'c'.repeat(64)
  for (const service of ['object-scanner', 'composer', 'finder', 'core'])
    await assert.rejects(session.fetch('/home-scenes', {}, service), (error) => error.code === 'session_required')
})

test('receipt currentness is the exact held receipt (canonical client has no isCurrent at this pin)', () => {
  const session = new WebSession({
    application: 'tenant',
    origin: APPLICATIONS.tenant,
    fetch: async () => { throw new Error('No request expected in source-currentness check.') },
    navigate: () => { throw new Error('No navigation expected in source-currentness check.') },
  })
  assert.equal(typeof session.isCurrent, 'undefined')
  const receipt = {
    contract: CONTRACT,
    csrf: 'c'.repeat(64),
    authenticated: true,
    user_id: '2a8459c4-77ef-5220-9a43-d16155fcf510',
    identity_contract: 'wisestay.identity.v1',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  }
  const current = (value) => value === session.receipt && session.authenticated
  session.receipt = receipt
  assert.equal(current(receipt), true)
  assert.equal(current({ ...receipt }), false)
  session.clear()
  assert.equal(current(receipt), false)
})
