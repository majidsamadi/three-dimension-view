#!/usr/bin/env node
/** Reproducible native shells around the same built Vue SPA. Never modifies an existing signing identity. */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const platform = process.argv[2]
if (!['android', 'ios'].includes(platform)) throw new Error('Usage: node scripts/native-setup.mjs android|ios')
if (!fs.existsSync('dist/index.html')) throw new Error('Build the Vue SPA first: npm run build')
const cap = path.resolve('node_modules/@capacitor/cli/bin/capacitor')
function run(args) { const result = spawnSync(process.execPath, [cap, ...args], { stdio: 'inherit' }); if (result.status !== 0) process.exit(result.status || 1) }
if (!fs.existsSync(platform)) run(['add', platform, ...(platform === 'ios' ? ['--packagemanager', 'SPM'] : [])])
run(['sync', platform])
if (platform === 'android') {
 const variables = 'android/variables.gradle'
 fs.writeFileSync(variables, fs.readFileSync(variables, 'utf8').replace(/minSdkVersion\s*=\s*\d+/, 'minSdkVersion = 26'))
 const manifest = 'android/app/src/main/AndroidManifest.xml'
 let xml = fs.readFileSync(manifest, 'utf8').replace(/android:allowBackup="[^"]*"/, 'android:allowBackup="false"')
 if (!xml.includes('android:allowBackup=')) xml = xml.replace('<application', '<application android:allowBackup="false"')
 if (!xml.includes('android:dataExtractionRules=')) xml = xml.replace('<application', '<application android:dataExtractionRules="@xml/data_extraction_rules"')
 fs.writeFileSync(manifest, xml)
 fs.mkdirSync('android/app/src/main/res/xml', { recursive: true })
 fs.writeFileSync('android/app/src/main/res/xml/data_extraction_rules.xml', `<?xml version="1.0" encoding="utf-8"?><data-extraction-rules><cloud-backup><exclude domain="root" path="."/><exclude domain="file" path="."/><exclude domain="database" path="."/><exclude domain="sharedpref" path="."/><exclude domain="external" path="."/></cloud-backup><device-transfer><exclude domain="root" path="."/><exclude domain="file" path="."/><exclude domain="database" path="."/><exclude domain="sharedpref" path="."/><exclude domain="external" path="."/></device-transfer></data-extraction-rules>`)
 // Native scanner is autoloaded through Capacitor's plugin registry; no custom Activity replacement.
 console.log('Android shell prepared. Run: cd android && ./gradlew assembleDebug testDebugUnitTest')
} else {
 const info = 'ios/App/App/Info.plist'
 let xml = fs.readFileSync(info, 'utf8')
 const entries = { NSCameraUsageDescription: 'Scan the shape of rooms locally and take reference photos that you choose to save.' }
 for (const [key, value] of Object.entries(entries)) if (!xml.includes(`<key>${key}</key>`)) xml = xml.replace(/<\/dict>\s*<\/plist>\s*$/, `<key>${key}</key><string>${value}</string>\n</dict></plist>\n`)
 fs.writeFileSync(info, xml)
 const privacyPath = 'ios/App/App/PrivacyInfo.xcprivacy'
 if (!fs.existsSync(privacyPath)) fs.copyFileSync('native/PrivacyInfo.xcprivacy', privacyPath)
 const xcode = require('xcode'), file = 'ios/App/App.xcodeproj/project.pbxproj', project = xcode.project(file)
 project.parseSync()
 if (!fs.readFileSync(file, 'utf8').includes('PrivacyInfo.xcprivacy')) {
  project.addResourceFile('App/PrivacyInfo.xcprivacy', { target: project.getFirstTarget().uuid }, project.getFirstProject().firstProject.mainGroup)
  fs.writeFileSync(file, project.writeSync())
 }
 console.log('iOS SPM shell prepared with camera purpose text and privacy manifest. Open ios/App/App.xcodeproj in Xcode 26+. Device signing remains the owner’s responsibility.')
}
