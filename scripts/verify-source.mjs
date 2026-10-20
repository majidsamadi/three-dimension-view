#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'))
for(const name of Object.keys({...pkg.dependencies,...pkg.devDependencies})) assert(!/^(react|react-dom|@ionic\/)/.test(name),`Forbidden UI dependency ${name}`)
assert(pkg.dependencies.vue && pkg.dependencies['vue-router'], 'Vue SPA dependencies are required')
const suha=fs.readFileSync('src/assets/suha.css','utf8')
assert(suha.includes('Designing World'), 'Preserve Suha attribution')
assert(!/@import\s+url|fonts\.googleapis|@font-face|display=swap|&amp;/.test(suha), 'No remotely loaded or bundled font files')
assert(fs.readFileSync('src/router.ts','utf8').includes('createWebHistory'), 'SPA router is required')
for(const directory of ['src','public','packages','native']) for(const file of fs.readdirSync(directory,{recursive:true})) {
 const full=path.join(directory,file); if(!fs.statSync(full).isFile())continue
 assert(!/\.(zip|ttf|otf|woff2?|w3d|glb|ply|obj|usdz)$/i.test(file),`Unapproved source asset: ${full}`)
}
for(const file of ['src/scanner/webxr.ts','packages/phone-scanner/ios/Sources/PhoneScannerPlugin/PhoneScannerPlugin.swift','packages/phone-scanner/android/src/main/java/com/wisestay/scanner/CaptureRenderer.java']) assert(!fs.readFileSync(file,'utf8').includes('sampleProject'),`Capture must not substitute sample geometry: ${file}`)
// Service mode (HSA-05/06): no direct network calls; default compositions stay disconnected.
const serviceFiles=[...fs.readdirSync('src/service').map(file=>path.join('src/service',file)),'src/views/ServiceUploadView.vue','src/views/ServicePublishView.vue']
for(const file of serviceFiles) assert(!/\bfetch\s*\(/.test(fs.readFileSync(file,'utf8')),`Service code must not call fetch( directly: ${file}`)
const compositions=fs.readFileSync('src/service/compositions.ts','utf8')
for(const name of ['createDefaultUploadComposition','createDefaultPublishComposition']) {
 const body=compositions.slice(compositions.indexOf(`export function ${name}`)); const end=body.indexOf('\n}\n')
 assert(end>0 && body.slice(0,end).includes('new HttpHomeScannerApi(createDisconnectedTransport())'),`${name} must use the disconnected transport`)
 assert(!/FakeHomeScannerApi/.test(body.slice(0,end)),`${name} must not use the fake API`)
}
for(const view of ['src/views/ServiceUploadView.vue','src/views/ServicePublishView.vue']) {
 const source=fs.readFileSync(view,'utf8')
 assert(/createDefault(Upload|Publish)Composition\(\)/.test(source),`${view} must default to the disconnected composition`)
 assert(!source.includes('home-scanner-fake'),`${view} must not import the fake API directly`)
}
console.log('Source policy checks passed: Vue SPA, actual Suha styles, no font/archive/scan redistribution, no sample substitution in capture engines, and disconnected service defaults with no direct fetch.')
