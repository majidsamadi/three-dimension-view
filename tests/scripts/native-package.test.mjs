import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { fixName } = require('@capacitor/cli/dist/plugin.js')
test('the scanner exports the SPM product requested by the installed Capacitor CLI', () => {
  const plugin = JSON.parse(fs.readFileSync('packages/phone-scanner/package.json', 'utf8'))
  const swift = fs.readFileSync('packages/phone-scanner/Package.swift', 'utf8')
  const expected = fixName(plugin.name)
  assert(swift.includes(`.library(name: "${expected}",`), `Missing SPM product ${expected}`)
  assert(swift.includes('targets: ["PhoneScannerPlugin"]'))
})
