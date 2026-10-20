# Decisions pending — three-dimension-view (HSA)

Source: WiseStay 3D Platform Implementation Work Breakdown v1.0, §6 "Decisions to make later" (Q01–Q16). This file records which open owner decisions block the remaining HSA subtasks, and what this slice deliberately left null or unset. It does not answer any question. It selects no algorithm, format, codec, crypto scheme, AWS service, threshold, timeout, price or device profile.

Status sources: Q07 `WiseStay_Human_First_Slice_Content_2026-10-14_210147.json` (first-slice content only); Q06 `WiseStay_F_Q06_Selected_Organization_v1.0` (result organisation ALT1 only). Every other question has no recorded answer.

| ID | WBS title | Status | Source of status | HSA subtasks blocked | Left null / unset in this slice |
|---|---|---|---|---|---|
| Q01 | Service and shared-component design | OPEN | WBS §6 | HSA-02.4 (session binding through the shared engine/service boundary), HSA-07.1 | No engine or backend client added. The preflight adapters stay injectable and default to unavailable (`src/home/preflight-adapters.ts`) |
| Q02 | Local capture and optional cloud refinement | OPEN | WBS §6 | HSA-05.3 | No cloud processing state or UI |
| Q03 | Scale, accuracy and acceptance | OPEN | WBS §6 | HSA-04.2 (scale evidence display), HSA-08.3 | Measurement stays "Available · unqualified" at most. Staleness in `src/home/preflight-presentation.ts` is revision-based only; no time threshold |
| Q04 | Devices and interaction delivery | OPEN | WBS §6 | HSA-02.3 (qualified capability), HSA-04.1, HSA-08.3 | The presentation never reports plain `ready`; the best status is `ready-unqualified` ("device capture is not qualified"). No device matrix |
| Q05 | Asset representations and protected opening | OPEN | WBS §6 | HSA-01.4 coexistence/migration implementation (also waits on RSV-01), HSA-04.1, HSA-08.2 | Migration states in `docs/LEGACY_PRESERVATION_REGISTER.md` are specified, not implemented. Legacy W3D/GLB/PLY/OBJ formats unchanged |
| Q06 | Product, quantity and planning semantics | OPEN — result organisation ALT1 recorded only | `WiseStay_F_Q06_Selected_Organization_v1.0` | none directly in HSA | — |
| Q07 | Audience, rented-home privacy and sharing | OPEN — first-slice content scope recorded only | `WiseStay_Human_First_Slice_Content_2026-10-14_210147.json` ("Synthetic data + permitted unoccupied references") | HSA-05.1, HSA-06.1, HSA-06.4 | Preflight fixtures are synthetic only. The action/audience matrix and consent remain OPEN |
| Q08 | Retention, deletion and evidence reuse | OPEN | WBS §6 | HSA-05.1 (retention implications), HSA-01.3 (diagnostic retention after failed conversion) | No retention periods |
| Q09 | Workload, cost and responsiveness | OPEN | WBS §6 | HSA-05.2, HSA-05.3 | No timeouts or budgets in the preflight or presentation |
| Q10 | Commercial viewing and portable delivery | OPEN | WBS §6 | HSA-06.1, HSA-08.2 (export of restricted scenes) | Free legacy export unchanged |
| Q11 | External developer onboarding | OPEN | WBS §6 | none in HSA | — |
| Q12 | Notification and support ownership | OPEN | WBS §6 | none in HSA | — |
| Q13 | Virtual routes versus live indoor navigation | OPEN | WBS §6 | none in HSA | — |
| Q14 | Shop/property registration compatibility | OPEN | WBS §6 | HSA-02.2 canonical property binding (with RSV-01), HSA-03 shop capture context | Property contexts come only from the injected adapter; none is created from local name/location |
| Q15 | Deployment and resource ownership | OPEN | WBS §6 | HSA-02.1 (origin registration via IDM-01), HSA-02.2 property binding, HSA-08.4 | WebSession `runtime_binding: not_configured`, `registration: not_selected` (`src/vendor/account-centre/shared-auth-source.json`) |
| Q16 | Application embedding and predecessor coverage | OPEN | WBS §6 | HSA-07.1–07.3 embedding/handoff into existing apps | No embedding or handoff route added |

## Deferred in this slice

- **WebGPU capability-detection stub: deferred (Q04/Q05).** Nothing consumes it before ARC-08/HSA-04.1, and a capability "present" signal would read as a renderer selection. `src/components/SceneViewer.vue` stays on three.js WebGLRenderer.
- **Web-session pin:** the vendored client is pinned to an unmerged upstream feature branch (`553ac3c0…`, 2 commits ahead of upstream `main`). Whether to re-pin to `main` once merged is an owner/IDM decision, OPEN.

## Other approvals

- Owner approval to merge `feature/3d-r0-foundation` into main: OPEN.
