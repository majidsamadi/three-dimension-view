import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import {
  APPLICATIONS,
  CONTRACT,
} from '../../src/vendor/account-centre/web-session.mjs'

const manifest = JSON.parse(fs.readFileSync('src/vendor/account-centre/shared-auth-source.json', 'utf8'))
const hash = (path) => createHash('sha256').update(fs.readFileSync(path)).digest('hex')

test('vendored canonical WebSession bytes stay pinned and Home Scanner remains unregistered', () => {
  assert.equal(manifest.canonical_repository, 'majidsamadi/wisestay-user-management-backend')
  assert.equal(manifest.canonical_commit, '9ee535d2793ef45a62631fffb8f360e5b30100e0')
  assert.equal(hash('src/vendor/account-centre/web-session.mjs'), 'a6e8d2c8541401c6f9b0e3eef29b7ec086de843f6d5738cea5475d1cb11dd336')
  assert.equal(hash('src/vendor/account-centre/web-session.d.mts'), '7b61f926bad524ec0e66fa61a05879de7498b6910ac3abb0dbc18e3f49882cbe')
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
