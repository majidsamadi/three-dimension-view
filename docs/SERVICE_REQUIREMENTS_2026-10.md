# Home Scanner application — service integration requirements

**Document:** HSA-SERVICE-ADDENDUM-001 · **Version:** 1.0 · **Date:** 14 October 2026  
**Repository:** majidsamadi/three-dimension-view  
**Status:** additive requirements only. Existing main was read at `4a2762ef9aa80ee7b123223ccfa1b723cb887aba`. This document does not implement SSO, backend upload, independent capture, WebGPU or protected-format migration.

Read the [existing owner requirements](OWNER_REQUIREMENTS.md) and current README for delivered behavior. New common references: [platform v1.0](https://github.com/majidsamadi/three-dimension-view-arcore-backend/blob/6cbca1ccdf4a8e9845b74451448eb0dea4f1109d/docs/PLATFORM_REQUIREMENTS.md), [contracts](https://github.com/majidsamadi/three-dimension-view-arcore-backend/blob/6cbca1ccdf4a8e9845b74451448eb0dea4f1109d/docs/CONTRACTS.md), [Home Scanner backend](https://github.com/majidsamadi/three-dimension-view-arcore-backend/blob/6cbca1ccdf4a8e9845b74451448eb0dea4f1109d/docs/REQUIREMENTS.md), [decisions](https://github.com/majidsamadi/three-dimension-view-arcore-backend/blob/6cbca1ccdf4a8e9845b74451448eb0dea4f1109d/docs/DECISIONS_AND_ACCEPTANCE.md). C = owner-confirmed; E = proposed engineering detail.

## 1. Current versus target

Current source documents a Vue/Suha local-first app with IndexedDB, native ARKit/Google ARCore capture, WebXR depth, a Three.js viewer, user-traced outlines and W3D/GLB/PLY/OBJ workflows. Those paths remain existing behavior; they are not already migrated to the independent engine, central SSO or a server-backed publication model. Old exports can include original uncropped geometry and private photos, so they must not be connected blindly to protected service assets.

Target: retain the UI and usable local data, consume the independent Home Scanner SDK/service, associate scans with Resvanta properties, upload deliberately, publish a reviewed home revision and let permitted viewers open it on other devices. WebGPU is the primary browser visualization target. Composer and Object Scanner are separate applications/services; this app can hand off safe scene/Object IDs but must not grow duplicate composition/asset-master backends.

Existing requirements and code are preserved. Conflicting old assumptions are amended only for the future service mode: no-account/local-only becomes centrally authenticated with explicit offline rights; Google ARCore capture does not satisfy independent-engine acceptance; unrestricted local export does not apply to newly protected service assets. No old scan is silently converted, deleted, published or reinterpreted as a measured property.

## 2. Proposed owner and viewer journeys

**HJ-01 Owner.** Central authentication -> choose/create canonical Resvanta property through the authorized service -> preflight -> qualified local capture -> actual preview/quality review -> safe local save -> explicit upload -> validation/optional consented refinement -> privacy/quality review -> publish scene revision. Rented-home content needs the approved media consent/audience policy.

**HJ-02 Prospective tenant.** Select a published property and 3D view -> authenticate centrally as required -> request current permitted scene entitlement -> load immutable protected files from authorized delivery -> render via WebGPU. No existing tenancy or owner's live phone is needed merely for eligible listing viewing; subscription/audience policy still applies.

**HJ-03 Composer handoff.** Owner opens Home Composer with the selected home revision. Only canonical references and safe navigation state travel; no bearer token, content key or direct unrestricted S3 URL. Composer obtains its own current permissions and does not modify the original scan.

**HJ-04 Legacy recovery/migration.** Detect old local records and format/version; preserve original data and keys; ask the user to map a local project to a real canonical property before service publication. Validate/redact a new derivative and obtain consent. Existing locally readable data stays recoverable; a failed migration does not clear IndexedDB or force app uninstall.

## 3. Screen additions and state requirements

Retain existing library/editor/capture views; add central-login return, canonical-property picker, service/local status, explicit upload queue, processing/validation state, privacy/publication review, shared-scene/library view and Composer handoff. Show source method, scale/calibration, geometry completeness and supported rendering/capture features. A top-down or user-traced outline is not labelled an automatically measured blueprint.

All new screens need complete offline/expired/denied/unsupported/stale/conflict/corrupt/recovery states. Hide unavailable features honestly rather than connect demo fixtures. Capture, viewing, cloud processing, sharing, publication and portable export have different rights and states.

## 4. Integration requirements

| ID | Basis | Requirement | Acceptance |
|---|---|---|---|
| HSA-SVC-001 | C | Preserve Vue SPA/Suha and consume reusable engine/service adapters. | No Ionic/React replacement or scanner duplication in view components. |
| HSA-SVC-002 | C | Integrate central Account Centre registration/SSO and safe return navigation. | Existing central login avoids repeated credentials; wrong/revoked sessions and unsafe return URLs denied. |
| HSA-SVC-003 | C | Resolve/create/search physical or virtual property only through Resvanta. | Legacy local project labels cannot silently become a second property master; type and canonical ID preserved. |
| HSA-SVC-004 | C+E | Keep service mode, legacy local mode and capture capabilities visibly distinct during migration. | Earlier ARCore/WebXR source is not labelled the independent engine; unsupported profiles do not fall back invisibly. |
| HSA-SVC-005 | C | Make WebGPU the primary browser scene viewer. | Actual device rendering/interaction qualifies WebGPU; any WebGL2 fallback is labelled separately. |
| HSA-SVC-006 | E | Decouple viewer, scanner, service API, entitlement, local storage and navigation. | A renderer change cannot bypass access or rewrite reconstruction data. |
| HSA-SVC-007 | C+E | Preserve qualified phone-local capture/preview and explicit offline rights. | Provisioned offline test reports actual capability; camera-only or uploaded processing is not called local reconstruction. |
| HSA-SVC-008 | E | Declare actual calibration, scale, capture time and observed/inferred geometry. | Unknown dimensions stay unknown; no automatic metres from legacy display units or user-entered height. |
| HSA-SVC-009 | E | Preserve safe local checkpoints and distinguish viewing restore from SLAM continuation. | Process death/reopen does not falsely resume tracking or stitch independent coordinate frames. |
| HSA-SVC-010 | C+E | Upload only after explicit permission to share the selected input/output data. | Raw photos/IMU/old uncropped backup are not automatically sent or published. |
| HSA-SVC-011 | E | Use backend-issued direct S3 transfer intents with resume and exact validation. | Lost response/expired part URL resumes the original operation without duplicates or credentials in the bundle. |
| HSA-SVC-012 | E | Distinguish uploading, uploaded, validating, optional processing, review-ready and published. | No transfer or GPU success badge substitutes for completed scene/privacy review. |
| HSA-SVC-013 | E | Treat cloud refinement as a separately enabled opt-in mode. | Consent, sufficient capture inputs and budget/profile required; original local scene preserved; no mandatory cloud dependency. |
| HSA-SVC-014 | C+E | Let owner preview and approve the exact published audience projection. | Private occupants/photos/notes/source geometry are removed from delivered bytes where required, not merely hidden controls. |
| HSA-SVC-015 | C+E | Support viewing a published version from another authorized account/device. | Owner phone offline; viewer needs only current scene entitlement and delivery/key access, not a private raw scan. |
| HSA-SVC-016 | E | Load exact coherent scene/asset revisions and keep cached authority bounded. | Changed/missing/tampered components, expired lease or account switch cannot reveal stale/private geometry. |
| HSA-SVC-017 | C+E | Provide safe Home Composer/Object Scanner handoffs without duplicate app responsibilities. | IDs/versions only in navigation; target reauthenticates and receives no universal content key. |
| HSA-SVC-018 | E | Preserve legacy W3D/GLB/PLY/OBJ data and export semantics within their old scope. | New protected assets cannot leak via legacy unrestricted export, snapshots, backup or plaintext debug helpers. |
| HSA-SVC-019 | E | Require explicit property mapping, format validation and consent for legacy migration. | Failure leaves originals/keys intact; old approximate geometry never gains verified-scale status through conversion. |
| HSA-SVC-020 | E | Dispose camera, workers, GPU and decrypted buffers on permission/context/navigation changes. | Late responses cannot restore an old user/home; device loss yields recoverable authorized renderer initialization. |
| HSA-SVC-021 | E | Preserve accessible non-3D alternatives and complete error/recovery states. | Text/object/room lists and safe actions remain usable without fine 3D dragging; unsupported capture is not simulated. |
| HSA-SVC-022 | E | Respect withdrawal/deletion and current source-asset rights. | Old URLs/caches cannot renew revoked view rights; remaining offline/CDN expiry windows are honestly disclosed. |
| HSA-SVC-023 | E | Validate actual phone, browser/WebGPU and cross-device security separately. | Generated/emulated results cannot close physical geometry or native/browser interoperability requirements. |
| HSA-SVC-024 | C+E | Preserve original app code/workflows in this documentation delivery and use reviewed branches for later implementation. | Diff is Markdown only; no Google-AR removal, model change, deployment, app installation or source-data migration is claimed. |

## 5. Data and service interfaces

Keep LocalProject and published SceneRevision distinct. Local projects may have no canonical property until the user deliberately associates one; do not auto-create properties from legacy free-text names/addresses. Store service references, accepted manifest digests, capture/upload operation IDs and pinned revisions with account scope. Core profile data, listings and reservations remain external authoritative records.

Use the Home Scanner backend capture/upload/resume/job/scene/publication/view-grant APIs and the common manifest/coordinate profile. Authenticate through actual released Account Centre consumer integration, not an invented independent JWT issuer. First-party app registration is an explicit deployment prerequisite. Native OS key storage and browser custody differ; new production grants require the approved cross-runtime format/key design.

Legacy saved source formats must be detected and parsed in bounded adapters. A cropped preview cannot justify uploading an uncropped original plus private photographs as the tenant-facing result. Preserve original signing key during phone updates; no uninstall/data clearing to force a new certificate. Data recovery/migration requires explicit fixtures for old records, old keys, partial uploads and current grants.

## 6. Release and acceptance

Implement shared AT01–08, AT09/10 for handoffs, AT15–22 as applicable. Minimum evidence: centrally signed-in owner selects a canonical real property, captures actual geometry, recovers an interruption, uploads deliberately, reviews/publishes a complete version, then another eligible account loads it using WebGPU while owner phone is offline. Verify protected legacy-export refusal and a failed migration preserving old data.

Outstanding gates: production codec/keys, metric coordinate profile, actual identity/property API compatibility, cloud mode, supported devices, quality thresholds, commercial audiences, rented-home consent, retention and public-source/template handling. Existing history stays readable and no open research experiment is adopted by this document.
