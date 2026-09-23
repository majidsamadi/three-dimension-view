# Architecture and design decisions

## ADR-001 — Keep the purchased Suha experience, deliver a real SPA

The supplied archive contains a Nuxt/Vue mobile e-commerce template. Its view structures, header/footer/sidenav, card and form rhythms, settings rows and help accordions are appropriate for this product, while its shopping routes, demo authentication, product data and SSR assumptions are not. Selected actual Suha CSS and component structures were ported into a Vue 3 + Vite + Vue Router application. No React/Ionic UI or remote font service is introduced. `docs/TEMPLATE_PROVENANCE.md` maps source patterns to application views.

## ADR-002 — Native spatial APIs, not a camera screenshot masquerading as 3D

Vue controls consent, project selection, lifecycle, review, storage and editing. Native camera surfaces sit behind the transparent live-capture Vue overlay. iOS uses `ARWorldTrackingConfiguration.sceneReconstruction = .mesh`, actual `ARMeshAnchor` additions/updates/removals and anchor-to-world transforms. Android consumes raw depth/confidence, camera intrinsics and ARCore camera pose, fusing only valid samples into bounded voxels and nearby triangle surfaces. Native geometry colours sample the observed camera image; they are vertex colours, not photographic texture atlases.

The WebXR implementation requests CPU depth and DOM overlay with immersive AR. The SDK’s pose/depth data drives reconstruction. A runtime advertising immersive AR is not proof that it grants CPU depth; missing features reject capture. Depth is planar camera-Z distance, so unprojection must not normalize the ray before multiplying by depth. Phone/browser compatibility remains runtime-specific.

## ADR-003 — Local data ownership and transactions

Projects, geometry/photo blobs and settings are stored locally. Binary buffers do not live in Vue’s deeply reactive object graph. IndexedDB writes atomically commit metadata and referenced assets. Every mutable project has an optimistic revision. Stale saves/deletes fail instead of overwriting another window. Asset ownership/type/reference checks prevent attaching another project’s blob accidentally. Deleting a section garbage-collects only unreferenced assets of that project after a successful transaction.

Recovery is separate from committed projects. During a scan, periodic checkpoints preserve partial geometry. Finishing does not imply the model is complete or accurate: it enters review. Only an explicit Save appends a section. Project save precedes recovery deletion; cleanup failure is reported separately from save success. Native app interruption pauses capture; resuming never invents absent camera observations. A native snapshot survives WebView/process loss, but recovered sections are reviewed rather than silently resumed into an incompatible AR origin.

## ADR-004 — Bounded geometry and explicit approximate measurements

The application caps individual geometry at 500,000 vertices/3,000,000 indices and portable projects at 256 MiB; live engines use smaller selected budgets. Fusion rejects missing/nonfinite depth, applies tracking/camera transforms, deduplicates voxels/triangles and refuses triangles with large edge gaps. This is not a globally optimized TSDF, NeRF or Gaussian-splat system. ARCore/ARKit supply pose tracking; this code does not claim independent global loop closure.

Scene coordinates are metres, right-handed, Y up, camera looking down -Z. Separate capture sessions begin independently. User transforms/crops are nondestructive metadata. Measurements/hotspots/room polygons bind to section-local coordinates and follow its transform. Floor plans are user-traced XZ projections; heights are explicitly entered, not inferred from an unobserved ceiling. Walk mode is navigation convenience, with no collision proof or safe physical-navigation claim.

## ADR-005 — Share files deliberately; no invented cloud integration

W3D archives carry validated metadata plus checksummed binary assets. Encrypted archives authenticate the entire container. Imports create new IDs, never overwrite existing projects. Model imports reject remote buffers and texture images; only bounded geometry/vertex colours are normalized. Exported SVG text is escaped. Reference photos are deliberately selected/captured and re-encoded to remove metadata; private defect/identity media from other WiseStay systems is not fetched.

There is no backend, public-link generation, account system or hard-coded WiseStay API. A future authorized Core media adapter must use existing identity and property authorization contracts and distinguish private project backups from public listing media. That is not implemented or represented as working in this repository.

## Evidence boundaries

Unit tests prove arithmetic/serialization/storage invariants with fake IndexedDB and synthetic geometry. Browser tests exercise real Vue/Three.js/IndexedDB/file download in Chromium and mobile viewport emulation. Native builds prove compilation and packaging, not physical AR operation. Physical accuracy, relocalization, interruptions, battery/thermal limits and store submission must be evaluated using `DEVICE_ACCEPTANCE.md` before customer release.
