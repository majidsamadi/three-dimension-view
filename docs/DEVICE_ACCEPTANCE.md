# Physical-device qualification — required before customer release

This checklist is **not a report of tests already passed**. Fill in actual model, OS, AR service version, app commit, dataset/room, observed result, failures, reviewer and date. Keep native builds, simulated geometry tests and actual sensor tests separate.

| Gate | Procedure and expected evidence |
| --- | --- |
| Capability | Test LiDAR Apple device, non-LiDAR Apple device, ARCore Depth Android, ARCore-without-Depth Android and ordinary desktop browser. Unsupported capture stays unavailable; library/viewer still works. |
| Just-in-time permission | Open all non-capture views with camera denied. No camera opens. Deny Start permission and return to a usable workspace. Grant later and retry. |
| Offline first-room scan | Install runtime beforehand, enable airplane mode, scan a known room, observe real geometry counts/mesh growing, stop/review/save/reopen and export without reconstruction network traffic. |
| Geometric validity | Scan a room with independently measured dimensions. Compare multiple lengths, large surfaces, depth discontinuities and return-to-start drift. Record numerical errors; do not invent an accuracy threshold after looking at results. |
| Materials and coverage | Test white walls, mirrors, transparent glass, low light, repetitive patterns, moving people and unseen corners. Missing data/warnings remain visible, no invented complete walls. |
| Motion/lifecycle | Pause/resume, screen-lock, phone call, background, rotation, permission revocation and tracking loss. No stale live-success state or unexpected camera restart. |
| Recovery | Kill the process during capture/after stop/during transfer/before project commit. Reopen the actual partial snapshot, save once, confirm original files remain until commit, and confirm cleanup afterward. |
| Storage | Test quota exhaustion, unavailable IndexedDB, damaged snapshots and 64-section/500k-vertex limits. Existing projects remain readable; failed save is not success. |
| Thermal/battery | Measure memory, battery drain, heat and sustained frame throughput on each target phone over representative capture duration. Record device-specific safe budgets. |
| Native Vue overlay | Confirm actual camera background remains visible, progress/control buttons remain tappable with safe areas, privacy indicators work, and returning from capture restores the ordinary Suha theme. |
| Cross-session alignment | Start two separate sections of connected rooms. Confirm independent origins are disclosed; manually align and compare to physical layout. No automatic stitching claim. |
| Export round trip | Export W3D/plain/encrypted and GLB/PLY/OBJ, transfer to another device, import into this app and an independent compatible viewer, verify geometry/units/colours/crops. Wrong passphrases/tampering are refused. |
| Privacy | Inspect runtime network traffic, system backups, share destinations, camera release and photo metadata. No hidden reconstruction upload. ARCore’s platform notice remains accessible. |
| Accessibility | VoiceOver/TalkBack, keyboard, large text, reduced motion, contrast, focus, accessible manual-coordinate alternatives and confirmation dialogs. Automated viewport tests are not WCAG certification. |
| Store release | Owner signing, app identifiers, privacy labels/manifests, third-party licensing, usage descriptions and store review. An unsigned simulator application is not an App Store release. |

Do not close these gates with screenshots of the illustrative sample. Store evidence outside the public repository when it includes the interior of a real private home.
