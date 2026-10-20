#!/usr/bin/env node
// Writes dist/release.json after `vite build` (wave 3 plan §6.3.2, OTA release format):
// {repository, origin, revision, files: {path: sha256}}. revision is $GITHUB_SHA or "local".
// deployment/publish.py re-hashes dist/ against this manifest before anything is uploaded.
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const site = JSON.parse(readFileSync('deployment/site.json', 'utf8'))
const dist = site.output
const files = {}
for (const entry of readdirSync(dist, { recursive: true }).map(String).sort()) {
  const full = join(dist, entry)
  const stat = lstatSync(full)
  if (stat.isSymbolicLink()) throw new Error(`Symbolic links are not published: ${entry}`)
  if (!stat.isFile() || entry === 'release.json') continue
  files[relative(dist, full).split(sep).join('/')] = createHash('sha256').update(readFileSync(full)).digest('hex')
}
if (!files['index.html']) throw new Error('dist/index.html is missing')
const revision = /^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA || '') ? process.env.GITHUB_SHA : 'local'
const release = { repository: site.repository, origin: site.origin, revision, files }
writeFileSync(join(dist, 'release.json'), JSON.stringify(release, null, 2) + '\n')
console.log(`release.json: ${Object.keys(files).length} files, revision ${revision}`)
