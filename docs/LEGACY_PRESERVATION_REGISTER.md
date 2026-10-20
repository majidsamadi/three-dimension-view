# Legacy preservation register (HSA-01.1, HSA-01.3)

**Package:** P01 source baseline · **Branch:** `feature/3d-r0-foundation` (from `origin/main` 75917b00a1, plus `feature/d-p06-home-preflight-code-01` @ c2e648e2de).
**Status:** draft for owner review. This register specifies what a future service mode must preserve. It implements no migration. Nothing here is integrated or accepted. Off-repo input: `WiseStay_Team_D_P06_Home_Entry_Preflight_v1.0.zip` `SOURCE_FINDINGS.md` (pinned to 75917b0).

## 1. Current local-first workflows (HSA-01.1)

| Workflow | Source | Tests | Engine / dependency |
|---|---|---|---|
| Create a local project (no account) | `src/views/NewProjectView.vue`, `newProject()` in `src/domain/types.ts` | `tests/unit/storage.test.ts` | Local only. No canonical property or account field |
| Browser depth capture | `src/scanner/webxr.ts`, `src/domain/reconstruction.ts` | `tests/unit/webxr-lifecycle.test.ts`, `tests/unit/reconstruction.test.ts` | WebXR depth + in-app voxel fusion. Does **not** use the `three-dimension-view-arcore` engine |
| Native capture (Capacitor plugin `PhoneScanner`) | `src/scanner/native.ts`, `packages/phone-scanner/` | `tests/unit/capture-lifecycle.test.ts`, `packages/phone-scanner/android/src/test/java/com/wisestay/scanner/VoxelMapTest.java` (CI `testDebugUnitTest`) | ARCore depth / ARKit mesh via the plugin. Does **not** use the arcore engine |
| Capture recovery | `src/data/drafts.ts`, `src/views/ScanView.vue`, `src/views/ProjectView.vue` | `tests/unit/storage.test.ts`, `tests/unit/capture-lifecycle.test.ts` | Separate recovery database |
| Viewing, editing, measurement | `src/components/SceneViewer.vue`, `src/views/ViewerView.vue`, `src/views/EditorView.vue`, `src/views/FloorplanView.vue` | `tests/unit/geometry.test.ts`; `tests/e2e/workspace.spec.ts` (Playwright, CI only) | three.js WebGLRenderer. Measurements are labelled estimates |
| Backup / restore | `src/domain/archive.ts`, `src/views/ExportView.vue`, `src/views/ImportView.vue` | `tests/unit/archive.test.ts` | Local file only |
| Model export / import (GLB, PLY, OBJ) | `exportModel()` and `importModel()`/`validateGLB()` in `src/services/models.ts`; delivery via `src/services/files.ts` | `tests/unit/formats.test.ts` | three.js `GLTFExporter`/`GLTFLoader` |
| Home entry preflight (prototype, not connected) | `src/home/preflight.ts`, `src/home/preflight-presentation.ts`, `src/views/HomePreflightView.vue` | `tests/unit/home-preflight*.test.ts`, `scripts/test-home-preflight.mjs` | No sign-in, property write or capture |

No current path uses the independent `three-dimension-view-arcore` engine. The app must not advertise an engine migration that has not happened.

## 2. Protected stores and formats

| Item | Definition | Preservation rule |
|---|---|---|
| `Project` schema v1 | `schemaVersion: 1` (`src/domain/types.ts` line 26), validated by `src/domain/validation.ts` | Never rewrite a v1 record into another schema in place. A future schema is additive or lives in a separate store |
| IndexedDB `wisestay-three-dimension-view` v1 | `src/data/database.ts` line 12: stores `projects` (keyPath `id`), `assets` (keyPath `id`, index `by-project` on `projectId`), `settings` | Keep the name, version and stores. No upgrade that drops or renames stores. Cross-tab notice via BroadcastChannel `three-dimension-view` |
| Recovery DB `wisestay-3d-capture-recovery` v1 | `src/data/drafts.ts` line 7: store `captures` keyed by `sessionId`, index `project` on `projectId` | Keep it separate from the workspace DB. Recovery drafts are not migrated or merged automatically |
| Project backup archive | `src/domain/archive.ts`: plain magic `W3DV0001`, password-protected magic `W3DE0001`, manifest `format: 'wisestay.project.v1'` with per-asset SHA-256 | Old backups must stay restorable. No format change without a new magic and version |
| Geometry binary `W3DG` v1 | `src/domain/geometry.ts`, documented in `docs/CAPTURE_CONTRACT.md` | Keep the reader for existing assets |
| GLB / PLY / OBJ export | `src/services/models.ts` (`exportModel`), `src/services/files.ts` (`deliverFile`) | Free portable export of legacy local projects stays available. HSA-08.2 must stop it reaching new restricted service scenes |
| Native capture snapshots | Android `packages/phone-scanner/android/src/main/java/com/wisestay/scanner/CaptureStore.java` (`noBackupFilesDir/three-dimension-capture`); iOS `packages/phone-scanner/ios/Sources/PhoneScannerPlugin/CaptureStore.swift` (Application Support `ThreeDimensionCapture`, excluded from backup) | UUID-derived paths only. Never delete snapshots during migration |
| Native scanner paths | Android `packages/phone-scanner/android/src/main/java/com/wisestay/scanner/PhoneScannerPlugin.java`, `VoxelMap.java`, `CaptureRenderer.java`; iOS `packages/phone-scanner/ios/Sources/PhoneScannerPlugin/PhoneScannerPlugin.swift`; web `src/scanner/webxr.ts` | Keep existing capture until a qualified engine path replaces it (ARC-03, HSA-03) |
| Routes | `src/router.ts`, including `/projects/:id/scan`, `/projects/:id/export`, `/import` | Keep existing local routes. `/projects/:id/preflight` is additive |
| App identity | `capacitor.config.ts` `appId: 'com.wisestay.threedimensionview'` | Changing it would orphan installed data |

## 3. Signing

There are no signing keys or signing config in the repo. Store signing is out of scope (audit §f). Evidence:

- `git ls-files` lists no `*.jks`, `*.keystore`, `*.p12`, `*.mobileprovision` or `key.properties`. `.gitignore` excludes `*.keystore` and `*.jks`.
- `scripts/native-setup.mjs` line 2: native shells never modify an existing signing identity. `tests/scripts/xcode-privacy.test.mjs` asserts `DEVELOPMENT_TEAM` and `CODE_SIGN_IDENTITY` are kept unchanged.
- `.github/workflows/ci.yml` builds Android `assembleDebug` and iOS with `CODE_SIGNING_ALLOWED=NO`. `README.md` says no certificates, profiles or team credentials are included.
- Updates must keep the owner's original signer so installed data survives (HSA-08.4).

## 4. Non-destructive migration states (HSA-01.3)

Every state below is **specified, not implemented**. Implementation is HSA-01.4, which waits on Q05 (representation and protected opening) and RSV-01 (canonical property qualification). See `docs/DECISIONS_PENDING.md`.

| State | Meaning | Must not |
|---|---|---|
| `legacy-local-only` | A v1 project exists only in the local stores, with no canonical association | Must not be hidden, deleted, or labelled migrated. Must not require sign-in to open |
| `association-proposed` | A canonical property was proposed for the project and is waiting for explicit user confirmation | Must not associate automatically. Must not derive a property from the project's free-text `name`/`location` |
| `associated` | The user confirmed one canonical property reference supplied by the authoritative service | Must not modify the v1 record's original fields. Must not create or edit a property master locally |
| `conversion-attempted` | A copy of local geometry/media is being prepared for service mode | Must not alter or delete the originals while converting |
| `conversion-failed` | Conversion stopped. The original stays readable and intact | Must not report success. Must not require uninstalling or clearing data. Must not delete the attempt's diagnostics silently |
| `abandoned-upload` | An upload started but was not confirmed by the backend | Must not mark the project published or uploaded. Must not discard the local original |
| `missing-keys` | Access material for protected content (for example a password-protected `W3DE0001` backup) is unavailable | Must not substitute another key or bypass protection. Must not delete the protected bytes |
| `unmapped-property` | No canonical property matches, or the service is unavailable | Must not fall back to a local property master. The project stays `legacy-local-only` |

## 5. Rules

- Never create a property from free-text name or location (HSA-01.2).
- Never delete or overwrite v1 data in `wisestay-three-dimension-view`, `wisestay-3d-capture-recovery`, backups or native snapshots during any migration.
- Uninstalling is never required to recover from a failed migration or a signature mismatch.
- Mark unsupported legacy capabilities explicitly instead of hiding them.
