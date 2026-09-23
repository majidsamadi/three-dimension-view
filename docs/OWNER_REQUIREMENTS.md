# Owner requirements and delivery boundary

Recorded from Majid Samadi’s explicit request, 23 September 2026:

1. Repository: `majidsamadi/three-dimension-view`, independently delivered.
2. Vue.js single-page application.
3. Use the actual owner-purchased Suha Nuxt/mobile ZIP and build the application’s views from its visual patterns; not an unrelated replacement design.
4. The conversation’s product objective is real-time phone-based house geometry capture and 3D viewing, with local reconstruction rather than a server upload disguised as local scanning.
5. Implement functioning workflows, not a template gallery or pretend camera demo.
6. Test the actual candidate, push changes, merge into `main`, and clear safely merged development branches while preserving their commit history.

Engineering decisions made for this delivery: Vite/Vue Router SPA rather than Nuxt SSR; Capacitor native bridges for ARKit/ARCore; browser WebXR depth where available; local IndexedDB storage; portable W3D backups; explicit capability and physical-qualification boundaries. These are implementation decisions, not claims that they were specified in the older master requirements.

No authorization is inferred to deploy infrastructure, change other repositories, publish a customer’s home, introduce a second shared account directory, operate IoT devices, or collect money. There is no fake backend URL, authentication bypass or generated live property inventory.

Applicable master principles retained: WS-GOV-007 Vue/native separation; WS-PRP-004 public/private media and fallback; WS-UX-003 complete screen states; WS-UX-009 just-in-time permissions; WS-UX-013 honest sample/integration labels; WS-REL-006 inspected refs and safe cleanup. The standalone project’s local archive is not a public property listing or an access grant.
