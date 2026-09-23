# Security and privacy boundary

This local workspace has no server account/session and must not be mistaken for WiseStay SSO or an authenticated multi-user vault. Anyone with access to the unlocked app/browser profile can access its local projects. There are no cloud API credentials, analytics endpoints or implicit published tours in the source.

Import boundaries: bounded file sizes/counts, schema validation, finite vertex coordinates and colour/index bounds, no external GLB buffers/images, OBJ material declarations ignored, exact binary lengths, W3D checksums, authenticated encrypted archives, new IDs for imported copies, escaped SVG text, no untrusted HTML rendering. These controls do not establish independent parser/security certification; restrict untrusted files according to deployment policy and keep upstream parsers updated.

Application capture is limited to owner-authorized rooms and deliberate camera permission. No room, location, contacts, faces or private scan data is uploaded automatically. Generated exports may contain sensitive geometry or possessions; the export screen requires a privacy review acknowledgement. Full W3D archives include original uncropped data, even when a visible model crop hides it. Deleting a project does not retract files already exported to other apps.

Native recovery uses UUID-derived private paths and bounded chunk reads. Snapshot persistence and cleanup failures remain separate from completed project saves. A compromised OS/browser profile is outside the protection boundary. Do not log raw scans, photos, passphrases or reusable credentials. Report issues privately to the repository owner; do not attach scans of occupied/private homes to public issues.

Before live distribution, complete physical-device, privacy, dependency and licensing reviews documented under `docs/DEVICE_ACCEPTANCE.md`. Browser/synthetic tests and successful native compilation are not substitutes for these reviews.
