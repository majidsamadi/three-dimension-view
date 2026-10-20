// Read-only pinned-source check for the vendored Account Centre WebSession client.
// Compares the local vendored bytes and src/vendor/account-centre/shared-auth-source.json
// against the canonical upstream file at the pinned commit (via `gh api`), then reports,
// informationally only, whether upstream `main` carries the same bytes.
// Exit codes: 0 pin matches; 1 pin mismatch; 2 `gh` unavailable/unauthenticated or fetch failed.
// Not run in CI: the upstream repository is private and CI has no token.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const MANIFEST_PATH = 'src/vendor/account-centre/shared-auth-source.json'
const HEX40 = /^[0-9a-f]{40}$/
const HEX64 = /^[0-9a-f]{64}$/

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Parse and validate the existing vendoring manifest. Pure: no I/O. */
export function parseManifest(text) {
  const manifest = JSON.parse(text)
  if (typeof manifest.canonical_repository !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(manifest.canonical_repository)) {
    throw new Error('manifest canonical_repository must be owner/name')
  }
  if (!HEX40.test(manifest.canonical_commit || '')) throw new Error('manifest canonical_commit must be a 40-hex commit')
  const entries = Object.entries(manifest.files || {})
  if (!entries.length) throw new Error('manifest lists no files')
  const files = entries.map(([localName, file]) => {
    if (!/^[\w.-]+$/.test(localName)) throw new Error(`unsafe local file name: ${localName}`)
    if (typeof file.canonical_path !== 'string' || file.canonical_path.startsWith('/') || file.canonical_path.split('/').includes('..')) {
      throw new Error(`unsafe canonical_path for ${localName}`)
    }
    if (!HEX64.test(file.sha256 || '')) throw new Error(`manifest sha256 for ${localName} must be 64-hex`)
    return { localName, canonicalPath: file.canonical_path, sha256: file.sha256 }
  })
  return { repository: manifest.canonical_repository, commit: manifest.canonical_commit, branch: manifest.canonical_branch, files }
}

/** Hash the vendored files next to the manifest and compare with the manifest. Offline. */
export function checkLocal(root = process.cwd()) {
  const manifestFile = resolve(root, MANIFEST_PATH)
  const manifest = parseManifest(readFileSync(manifestFile, 'utf8'))
  const dir = dirname(manifestFile)
  const files = manifest.files.map(file => {
    const local = sha256(readFileSync(join(dir, file.localName)))
    return { ...file, local, localMatches: local === file.sha256 }
  })
  return { manifest, files }
}

function ghRaw(repository, path, ref) {
  return execFileSync('gh', ['api', '-H', 'Accept: application/vnd.github.raw', `repos/${repository}/contents/${path}?ref=${encodeURIComponent(ref)}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  })
}

export function main(root = process.cwd()) {
  let local
  try {
    local = checkLocal(root)
  } catch (error) {
    console.error(`web-session upstream check: ${error.message}`)
    return 1
  }
  const { manifest, files } = local
  try {
    execFileSync('gh', ['auth', 'status'], { stdio: 'ignore' })
  } catch {
    console.error('web-session upstream check: gh CLI unavailable or not authenticated (exit 2)')
    return 2
  }
  let failed = false
  for (const file of files) {
    let pinned, main
    try {
      pinned = sha256(ghRaw(manifest.repository, file.canonicalPath, manifest.commit))
    } catch (error) {
      console.error(`web-session upstream check: could not fetch ${file.canonicalPath}@${manifest.commit}: ${String(error.stderr || error.message).trim()}`)
      return 2
    }
    try {
      main = sha256(ghRaw(manifest.repository, file.canonicalPath, 'main'))
    } catch {
      main = 'unavailable'
    }
    const pinOk = file.localMatches && pinned === file.sha256
    if (!pinOk) failed = true
    console.log(`${file.localName}: local=${file.local.slice(0, 12)} manifest=${file.sha256.slice(0, 12)} pin=${pinned.slice(0, 12)} -> ${pinOk ? 'pin matches' : 'PIN MISMATCH'}; upstream main ${main === pinned ? 'same' : 'differs'} (${main.slice(0, 12)}, informational)`)
  }
  console.log(`pinned ${manifest.repository}@${manifest.commit}${manifest.branch ? ` (${manifest.branch})` : ''}: ${failed ? 'MISMATCH' : 'verified'}`)
  return failed ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(resolve(dirname(fileURLToPath(import.meta.url)), '..'))
}
