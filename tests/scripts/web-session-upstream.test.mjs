import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { checkLocal, MANIFEST_PATH, parseManifest, sha256 } from '../../scripts/check-web-session-upstream.mjs'

// Offline only: the upstream comparison needs `gh` and is run manually (see README "Vendored code").
test('vendored WebSession bytes match the pinned manifest without network access', () => {
  const { manifest, files } = checkLocal()
  assert.equal(manifest.repository, 'majidsamadi/wisestay-user-management-backend')
  assert.equal(manifest.commit, '553ac3c08973114f26271d1a751437d9203b5cd4')
  assert.deepEqual(files.map(file => file.canonicalPath), ['clients/web-session/web-session.mjs', 'clients/web-session/web-session.d.mts'])
  for (const file of files) assert.equal(file.localMatches, true, file.localName)
})

test('manifest parsing rejects unsafe or incomplete pins', () => {
  const good = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
  const variant = change => JSON.stringify({ ...good, ...change })
  assert.throws(() => parseManifest(variant({ canonical_commit: 'main' })), /40-hex/)
  assert.throws(() => parseManifest(variant({ canonical_repository: 'not a repo' })), /owner\/name/)
  assert.throws(() => parseManifest(variant({ files: {} })), /no files/)
  assert.throws(() => parseManifest(variant({ files: { 'web-session.mjs': { canonical_path: '../x', sha256: 'a'.repeat(64) } } })), /unsafe/)
  assert.throws(() => parseManifest(variant({ files: { 'web-session.mjs': { canonical_path: 'clients/x.mjs', sha256: 'short' } } })), /64-hex/)
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})
