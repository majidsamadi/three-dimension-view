# Three Dimension View

A **Vue 3 single-page application** for creating a private library of house scans, exploring geometry in 3D, adding useful context, and exporting portable files. The interface is adapted from Majid Samadi’s purchased **Suha mobile Nuxt template**. It is not a collection of disconnected template demo pages.

## What is implemented

| Workflow | Implementation |
| --- | --- |
| Home and project library | Real local records, search, sorting, favorites, empty/error states and responsive Suha cards/navigation |
| Property/project setup | Name, optional private location text, notes, independent scan sections, reference photos |
| Live Apple capture | Native ARKit scene reconstruction, actual mesh-anchor updates, sampled vertex colours, live camera/mesh overlay, pause/resume, bounded snapshots; requires supported LiDAR hardware |
| Live Android capture | Native ARCore pose + raw depth/confidence + camera samples, incremental voxel/triangle fusion, actual camera/point overlay, pause/resume and snapshots; requires an ARCore Depth-compatible phone |
| Browser capture | WebXR CPU depth + real camera poses on browsers that grant the required AR/depth/DOM-overlay session; no synthetic camera fallback |
| Recovery | Periodic local snapshots, interrupted-scan review, explicit save/discard, native private recovery files retained until project save |
| Interactive viewer | Orbit, top view, walkthrough controls, grid/wireframe, fullscreen, image snapshot, annotation focus; walkthrough has no collision/navigation guarantee |
| Editor | Names/notes, section transforms and scale, nondestructive crop, section removal, hotspots, measurements, photo captions, bounded undo/redo and revision-conflict refusal |
| Floor plan | User-traced room outlines on existing geometry, names/floors/entered heights, approximate areas and SVG export |
| Import | W3D complete-project copies; geometry/vertex-colour GLB, PLY and OBJ imports with size/type/reference validation |
| Export | W3D complete backup, optional passphrase encryption, GLB/PLY/OBJ geometry exports and deliberate operating-system file sharing |
| Local-first operation | IndexedDB project/assets, offline cached SPA, no account, no reconstruction API, no analytics or automatic upload |
| Supporting views | Compatibility diagnostics, storage/preferences, searchable scanning guide, privacy information and not-found recovery |

**Important limits:** this is geometry reconstruction, not a photorealistic Gaussian-splat or Matterport-equivalent product. There is no neural RGB-only reconstruction fallback on every ordinary phone, no automatic semantic room/furniture recognition, no automatic cross-session registration or whole-house loop-closure optimizer, and no claim of survey-grade measurements. Room outlines are deliberately user-traced. Reference photos are not promoted to 3D scans. The sample apartment is visibly labelled illustrative and is never used by a capture engine.

The native source must be compiled and tested on real supported phones before being described as physically qualified. Passing browser tests or an iOS simulator build does not prove camera performance, geometric accuracy, thermal behaviour, or app-store acceptance. See [device acceptance](docs/DEVICE_ACCEPTANCE.md) and the exact commit’s GitHub Actions results.

## Run the SPA

Use Node.js 24 LTS (minimum 22.12), npm, and the committed lockfile:

```sh
npm ci
npm run dev
```

Open the printed localhost URL. Desktop browsers can manage/import/edit/view projects. Live room capture depends on actual device/runtime capabilities. A phone accessing a development computer over ordinary LAN HTTP does **not** receive secure-context camera/AR privileges; use a trusted HTTPS development endpoint or a native build.

```sh
npm run verify:source
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run preview
```

`dist/` is a static SPA. No Node reconstruction server, SSR runtime, API key, AWS account or login is required. When hosting below a subpath, set `APP_BASE_PATH=/chosen-path/` at build time and configure history fallback to that path’s `index.html`. See [deployment](docs/DEPLOYMENT.md). No deployment is performed by CI.

## Run on a phone

The application UI remains Vue/Suha inside Capacitor. Swift and Java implement only the native camera/AR/render/storage bridge; **Ionic Framework and React are not dependencies**.

### Android

Install Android Studio Otter or newer, Android SDK 36 and Java 21. Then:

```sh
npm ci
npm run native:android
cd android
./gradlew assembleDebug testDebugUnitTest
```

On Windows use `gradlew.bat`. The generated Android shell has a minimum SDK of 26, app backups disabled, and the local scanner plugin linked automatically. Install the debug APK on an owned test phone. Install/update Google Play Services for AR when prompted, reopen the app, create a space and deliberately start capture. Availability of ARCore alone does not establish Depth support; the app checks the session configuration.

### iOS

A Mac with Xcode 26+ is required. Native scanning requires an ARKit scene-reconstruction-capable LiDAR iPhone/iPad; an iOS simulator cannot supply a real room scan.

```sh
npm ci
npm run native:ios
npx cap open ios
```

Choose the owner’s signing team and a physical device. The generation script uses Swift Package Manager, adds the camera purpose text and registers the privacy manifest. No signing certificates, provisioning profiles or team credentials are included. Generated `android/` and `ios/` shells are reproducible outputs; authoritative bridge source lives in `packages/phone-scanner/`.

## A practical first journey

Create a space → check the device → read/accept the capture privacy notice → scan one room slowly → pause or stop → inspect the actual geometry → save locally → edit annotations/measurements or trace room outlines → export a W3D backup.

One continuous scan shares an AR session origin. A new capture starts a **different local coordinate frame**. Multiple sections are not automatically stitched: use the section editor to align them against known features and verify the result. Do not infer that two overlapping origins mean the rooms occupy the same physical position.

## Storage and privacy

Project records and blobs stay in the local browser/WebView’s IndexedDB. Native recovery geometry uses private, backup-excluded native files. Clearing application/browser data or uninstalling can remove projects. Requesting persistent browser storage is advisory, not a backup guarantee. Browser storage is not an authenticated multi-user vault. Device/browser operating-system services have their own policies.

W3D backups include the **original uncropped geometry**, notes and photos. Geometry exports apply current transforms/crops. Encrypted W3D uses PBKDF2-SHA256 (310,000 iterations, random 16-byte salt) and AES-256-GCM (random 12-byte nonce); forgotten passphrases cannot be recovered. This implementation is not a claim of independent cryptographic certification. Ordinary GLB/PLY/OBJ exports are not encrypted.

This application runs on Google Play Services for AR (ARCore), which is provided by Google LLC and governed by the Google Privacy Policy. Cloud Anchors and geospatial capture are not enabled by this application.

## Project structure

```text
src/views/                 All Vue application screens
src/components/            Suha-derived shell/cards/forms plus Three.js viewer
src/assets/suha.css        Selected actual purchased Suha styles with attribution
src/assets/app.css         Scanner-specific design system and responsive states
src/domain/                Typed project model, validation, geometry, fusion, archives
src/data/                  Atomic IndexedDB repository and recovery storage
src/scanner/               Typed native bridge and WebXR depth engine
src/services/              Import/export, photos, SVG plans, device diagnostics
packages/phone-scanner/     Native ARKit/ARCore capture implementations
native/                    Native application privacy configuration
scripts/                   Reproducible native generation and source checks
tests/                     Domain/storage/format tests and browser journeys
docs/                      Architecture, capture contract, provenance, release gates
```

## Ownership and template provenance

Majid requested this separate repository on 23 September 2026. The instructions are retained in [owner requirements](docs/OWNER_REQUIREMENTS.md). The older WiseStay master only defines approved 3D-tour references/media privacy; it is **not** a pre-existing specification for this reconstruction engine. This standalone scanner adds no duplicate WiseStay identity or pretend Core integration.

See [Suha provenance](docs/TEMPLATE_PROVENANCE.md) and [third-party notices](THIRD_PARTY_NOTICES.md). The original purchased ZIP, demo storefront pages, unrelated product images, private requirements documents, font files and scan data are not redistributed. Public repository visibility does not grant a licence to extract or resell the purchased template-derived assets.
