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

test('vendored canonical WebSession bytes stay pinned and Home Scanner remains unregistered', () => {
  assert.equal(manifest.canonical_repository, 'majidsamadi/wisestay-user-management-backend')
  assert.equal(manifest.canonical_commit, '553ac3c08973114f26271d1a751437d9203b5cd4')
  assert.equal(manifest.canonical_tree, 'c032cf7ed87eb5168272e2e9a5eab612803da146')
  assert.equal(hash('src/vendor/account-centre/web-session.mjs'), '8c83b03365b1a3eac5259d9c32ccc52c703fe6832c3dcbbe010ec05e02ca6b91')
  assert.equal(hash('src/vendor/account-centre/web-session.d.mts'), '14a50fafea96514452d31066e6c47eecbe79cf9d9858905f87570280d6497dd9')
  assert.equal(CONTRACT, 'wisestay.web-session.v1')
  assert.deepEqual(Object.keys(APPLICATIONS), [
    'owner', 'tenant', 'iot', 'service-manager', 'ota', 'admin', 'resvanta', 'main-mobile', 'iot-mobile',
  ])
  for (const unregistered of ['home', 'home-scanner', 'composer', 'finder']) {
    assert.equal(Object.hasOwn(APPLICATIONS, unregistered), false)
  }
  assert.equal(manifest.runtime_binding, 'not_configured')
  assert.equal(manifest.registration, 'not_selected')
})

test('canonical isCurrent distinguishes exact process-local receipt freshness without creating authority', () => {
  const session = new WebSession({
    application: 'tenant',
    origin: APPLICATIONS.tenant,
    fetch: async () => { throw new Error('No request expected in source-currentness check.') },
    navigate: () => { throw new Error('No navigation expected in source-currentness check.') },
  })
  const receipt = {
    contract: CONTRACT,
    csrf: 'c'.repeat(64),
    authenticated: true,
    user_id: '2a8459c4-77ef-5220-9a43-d16155fcf510',
    identity_contract: 'wisestay.identity.v1',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  }
  session.receipt = receipt
  assert.equal(session.isCurrent(receipt), true)
  assert.equal(session.isCurrent({ ...receipt }), false)
  session.clear()
  assert.equal(session.isCurrent(receipt), false)
})
