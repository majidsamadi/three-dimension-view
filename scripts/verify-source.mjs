#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'))
for(const name of Object.keys({...pkg.dependencies,...pkg.devDependencies})) assert(!/^(react|react-dom|@ionic\/)/.test(name),`Forbidden UI dependency ${name}`)
assert(pkg.dependencies.vue && pkg.dependencies['vue-router'], 'Vue SPA dependencies are required')
const suha=fs.readFileSync('src/assets/suha.css','utf8')
assert(suha.includes('Designing World'), 'Preserve Suha attribution')
assert(!/@import\s+url|fonts\.googleapis|@font-face/.test(suha), 'No remotely loaded or bundled font files')
assert(fs.readFileSync('src/router.ts','utf8').includes('createWebHistory'), 'SPA router is required')
for(const directory of ['src','public','packages','native']) for(const file of fs.readdirSync(directory,{recursive:true})) {
 const full=path.join(directory,file); if(!fs.statSync(full).isFile())continue
 assert(!/\.(zip|ttf|otf|woff2?|w3d|glb|ply|obj|usdz)$/i.test(file),`Unapproved source asset: ${full}`)
}
for(const file of ['src/scanner/webxr.ts','packages/phone-scanner/ios/Sources/PhoneScannerPlugin/PhoneScannerPlugin.swift','packages/phone-scanner/android/src/main/java/com/wisestay/scanner/CaptureRenderer.java']) assert(!fs.readFileSync(file,'utf8').includes('sampleProject'),`Capture must not substitute sample geometry: ${file}`)
console.log('Source policy checks passed: Vue SPA, actual Suha styles, no font/archive/scan redistribution, and no sample substitution in capture engines.')
