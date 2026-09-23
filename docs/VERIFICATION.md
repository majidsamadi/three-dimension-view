# Verification and release evidence

## Reproduce the automated acceptance gates

Use the committed lockfile. GitHub Actions runs Node 24 on Ubuntu 24.04 and Xcode 26 on macOS 15. The local verification environment used Linux x86-64 and Node 22.16.0 with dependencies reproduced from that same lockfile.

| Gate | Command / coverage |
| --- | --- |
| Source provenance and policy | `npm run verify:source`: Vue SPA, actual attributed Suha styles, no fonts, purchased archive, private documents or customer scan redistribution |
| Strict Vue / TypeScript | `npm run typecheck` |
| Native build graph regression | `npm run test:scripts`: five cases for Xcode privacy-resource registration, idempotency, signing preservation, malformed graph rejection and matching the installed Capacitor CLI's SPM product name |
| Unit / component verification | `npm test`: 80 cases for geometry, depth reconstruction, archive encryption/tampering, model formats, IndexedDB revisions, confirmation accessibility and camera lifecycle |
| Production web build | `npm run build`: static Vue SPA plus offline service worker |
| Browser end-to-end | `npm run test:e2e`: 24 cases, 12 each in desktop Chromium and mobile-viewport Chromium |
| Dependency security | `npm audit --audit-level=moderate --json`: advisory failures block the web job; the report is retained |
| Android | `npm run native:android`, then `./gradlew assembleDebug testDebugUnitTest`: compile the real application/plugin and execute eight pure-Java reconstruction tests |
| iOS | `npm run native:ios`, repeat setup and compare Xcode project hashes, then unsigned complete iOS simulator application build |

Browser cases exercise actual rendered views, IndexedDB persistence, editing, safe deletion, floor-plan SVG export, W3D export/import, invalid archive refusal, offline reload, supported-format round trips, and honest unsupported capture states. GLB/PLY/OBJ round trips use actual exported bytes, not substituted geometry. ASCII PLY verifies a three-point cloud remains three points with zero invented triangles. Mobile viewport emulation is not a physical phone sensor test.

The lifecycle component test uses an explicitly simulated native bridge. It verifies navigation cannot race camera startup and unexpected unmount requests native stop while removing the Vue camera overlay. It is not ARKit/ARCore hardware evidence.

## Exact source and evidence

The current pull request and each exact commit's **Verify Vue SPA and native scanners** workflow are the authoritative automated results. A passing older run does not qualify a newer source revision. The source-provenance artifact includes the tracked-source archive, commit ID and SHA-256 digest. PR checks build GitHub's temporary merge commit; main checks build the actual merged main commit.

Retained artifacts contain:

- Web: production `dist`, unit-test JSON, browser JSON/HTML reports, screenshots/traces where produced, and dependency audit JSON.
- Android: debug APK when compilation succeeds, complete Gradle output, and native JUnit XML/HTML reports.
- iOS: complete Xcode build output and the unsigned simulator application when compilation succeeds.

No public website, AWS stack, signed iPhone distribution, App Store submission or Play Store publication is performed by these workflows. Downloadable build artifacts are development deliverables, not a declaration of physical qualification.

## Resolved original failures

The remediation retains the original implementation and assertions:

1. PLY unit tests no longer mix Node File buffers with JSDOM's ArrayBuffer constructor. Actual browser format round trips provide independent coverage.
2. The Suha stylesheet no longer contains the malformed remnant of its removed external font import. The source gate prevents recurrence.
3. Xcode registration uses the actual file-reference/resource-phase graph rather than assuming a group named Resources; repeated native generation preserves the graph and signing settings.
4. The Swift package exports the product name that Capacitor actually requests for `@wisestay/phone-scanner`.
5. Android declares the AppCompat dependency needed by Capacitor's activity API, reads recovery metadata using bounded API-26-compatible I/O, handles checked numeric JSON failures, and serializes finite preview values through the collection constructor.
6. Destructive confirmation tests target the correct `alertdialog` role. Escape cannot cancel an in-progress write, keyboard focus is contained/restored, and the missing-page view has a proper page-level heading.
7. Vitest 4.1.11 and the scoped CommonJS-compatible UUID 11.1.1 override remediate the reported development-tool advisories without replacing the app framework or dropping tests.

The temporary hash-verified source-delivery workflow was removed after its patches were materialized as normal tracked files. Only normal verification and ancestry-checked branch cleanup remain.

## Physical and product boundaries

No physical handset was connected to the verification environment. Actual AR tracking, depth/mesh quality, dimensional error, thermal behaviour, camera interruptions and airplane-mode walkthroughs require the separately recorded matrix in [DEVICE_ACCEPTANCE.md](DEVICE_ACCEPTANCE.md). Do not close that matrix with sample screenshots, unit-test mocks, Android compilation or a simulator build.

The product captures and edits approximate geometry on supported runtimes. It does not claim universal ordinary-phone RGB-only reconstruction, automatic room/furniture recognition, automatic multi-session stitching, global house loop closure, Gaussian splats, survey accuracy, or live WiseStay backend integration. Reference photos remain photos; manually traced floor plans remain explicitly manual.

## Merge and cleanup

Merge through PR #1 with a merge commit after the exact candidate's checks pass. The cleanup job checks that the named implementation branch's exact head is an ancestor of main, deletes only that preserved branch with an expected-head lease, and records the head/main IDs. Unrelated work must never be removed for a one-branch target. Verify the resulting branch list and the merged main build independently.
