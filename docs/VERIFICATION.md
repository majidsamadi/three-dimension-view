# Scanner delivery verification

## Remediation batch — 23 September 2026

Source repairs are preserved at `de4f21e041768770b93d9969d4eaecc9aaadd3dc`. The delivery process checked SHA-256 hashes of every original and resulting source file, applied the exact reviewed patch, and generated the dependency lock without executing install scripts.

Resolved causes:

- PLY parser tests now run in a single Node ArrayBuffer realm rather than mixing Node File buffers with JSDOM's constructor. Real-browser ASCII PLY and binary PLY/GLB/OBJ round trips are separate Playwright cases; their expected geometry is not replaced with fake results.
- iOS privacy-manifest registration uses the application's actual file-reference/resource-phase graph, not a nonexistent group named Resources. Regression tests cover first registration, idempotency, repair, and preservation of signing settings.
- Android explicitly declares the AppCompat compile dependency exposed by Capacitor's API. Recovery metadata uses a bounded, API-26-compatible UTF-8 read with AtomicFile recovery.
- Removed the broken remainder of Suha's external font import while preserving its actual stylesheet and attribution.
- Updated Vitest to 4.1.11 and scoped xcode's UUID dependency to CommonJS-compatible 11.1.1 for the reported development-tool advisories. The lockfile remains authoritative.

## Executed local verification

Environment: Linux x86-64, Node 22.16.0, dependencies reproduced from the repository's exact CI-generated lockfile.

| Check | Result |
| --- | --- |
| Source policy and template provenance checks | Passed |
| Strict Vue/TypeScript check | Passed |
| Xcode resource-graph regression tests | 4 passed; 0 failed; 0 skipped |
| Domain, persistence, archive, formats and fusion tests | 75 passed; 0 failed; 0 skipped |
| Production Vue SPA/PWA build | Passed; 39 precached resources; no malformed-font CSS warning |

The complete candidate CI additionally executes real Chromium desktop/mobile browser journeys, Android application compilation/native fusion tests, iOS simulator compilation and repeated native setup. Their results must be recorded before merge; local unit tests are not substitutes for those jobs.

## Physical scope

No physical handset was connected to this verification environment. Actual AR tracking, depth/mesh quality, dimensions, thermals, camera interruption handling and airplane-mode walkthroughs require the matrix in `DEVICE_ACCEPTANCE.md`. Simulator/native build success must never be labelled physical qualification. There is no app-store signing, public/cloud deployment or WiseStay backend activation in this source-delivery task.
