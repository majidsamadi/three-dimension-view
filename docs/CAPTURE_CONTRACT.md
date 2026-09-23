# PhoneScanner v1 and geometry contract

All methods are exposed through the locally registered Capacitor plugin `PhoneScanner`; there is no network endpoint. Every start binds UUID `sessionId` and UUID `projectId`. File paths are derived from validated UUIDs, never accepted from JavaScript.

| Method | Request | Result |
| --- | --- | --- |
| getCapabilities | none; does not open the camera | platform, available, support (`supported`, `unsupported`, `needs-check`), reason, source, canPause |
| start | sessionId, projectId, quality (`balanced`, `detail`) | resolves only when local capture is started; otherwise an explicit error |
| pause / resume | none | applies to the one active session; no new coordinate frame on a normal resume |
| stop | none | durable snapshot metadata; no success for an empty scan |
| cancel | none | stops capture and removes that session’s recovery snapshot |
| getRecoveries | none | bounded metadata for stored native snapshots |
| readChunk | sessionId, vertexOffset/count, indexOffset/count | numeric position/colour/index arrays for only the requested validated slice |
| discard | sessionId | removes only that stored snapshot |

Progress event: sessionId, vertices, triangles, frames, elapsedMs, tracking, paused, budgetReached, bounded preview positions and optional explanatory message. Counts derive from observed/fused data. They are not a room-completion percentage. JavaScript verifies the session ID before showing progress.

Stop/recovery metadata: sessionId, projectId, source (`arkit-mesh`, `arcore-depth`), vertices, indices, elapsedMs, capturedAt, warnings. JavaScript validates schema, counts, ownership and every transferred index/coordinate before saving. Maximum chunk: 4,096 vertices and 12,288 indices. A lost/incomplete transfer leaves the native recovery file intact.

## W3DG binary geometry

Little-endian 20-byte header: magic `W3DG`, u32 version 1, u32 vertex count, u32 index count, u32 flags (0=no colours, 1=RGB colours). Payload: 3 float32 coordinates per vertex; optional 3 float32 linear RGB values per vertex; u32 indices in complete triples. Exact file size is checked. Coordinates must be finite within ±100,000 m; colours are finite within [0,1]; indices must reference an existing vertex. Zero triangles means a genuine point cloud, not fabricated faces.

## Native lifecycle

Camera permission is requested only after the user presses Start and accepts the capture notice. App background/interruption pauses processing and attempts a local checkpoint. Stop first stops capture, obtains actual accumulated geometry, persists the snapshot, then returns metadata. Native and WebView recovery are not evidence of cloud storage. Native snapshots are app-private and excluded from normal backup; exported files leave that boundary only through deliberate file sharing.

A successful one-room scan does not qualify full-house scale. Each separately started scan has its own origin. The editor provides explicit manual transforms; no implicit “merged house” success flag exists.
