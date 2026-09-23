# Purchased Suha source provenance

Source: owner-supplied `themeforest-84bsRycE-suha-pwa-ecommerce-mobile-nuxt-js-template.zip`.
SHA-256 of the supplied archive: `b5f473ada5e268c3066b278b5cc8c0395ce55194dbad2d10226da243c3b83bb0`.

The archive was inspected directly. It contains Vue single-file components, Nuxt configuration, a Bootstrap-based mobile visual system, assets and template documentation. The compiled stylesheet’s attribution identifies Designing World, version 4.0.0 (1 January 2026); this is source metadata, not an independently verified publication date or a new licence grant.

## Actual reuse, not just a template name

`src/assets/suha.css` contains selected actual source stylesheet sections (original line ranges 1–199, 221–477, 934–1440, 1717–1932, 2319–2450, 2554–2707, 3868–3972 and 4372–4529): reboot, shortcodes/miscellaneous, header/footer/sidenav, welcome, settings, product-card, FAQ/accordion and profile patterns. The original header remains. Remote Google Fonts imports and font/unused image URLs were removed. The original purple primary was adapted to WiseStay green. Scanner-specific styles extend it in `src/assets/app.css` rather than silently replacing the purchased source with another framework.

| Supplied Suha pattern | Implemented use |
| --- | --- |
| HeaderTwo/HeaderThree, side-menu and footer navigation | `AppShell.vue`, desktop header, mobile fixed navigation, drawer and brand placement |
| Welcome/hero panels and utility classes | Home, new-project, scan preparation and import views |
| Shop-grid/product cards | Local project library cards, real record titles/counts/favorites, list/grid views; no fictitious inventory |
| Product-detail/card sections | Project overview, actual model preview, reference photos and section details |
| Form/checkout composition | Project creation, editor fields, import/export controls and consent review |
| Settings rows and theme composable pattern | Local theme/unit/quality/storage preferences with persistent state |
| Help/FAQ accordion | Searchable scanning guide and contextual troubleshooting |
| Mobile spacing, rounded surfaces and sticky controls | Capture/review, 3D viewer, section editor, floor-plan view and safe actions |

All application routes are actual Vue views connected to the local domain/repository/capture services. Specialized native camera surfaces render real AR data underneath Vue controls; they are not separate Swift/Android form-based replacement UIs. Three.js renders geometry inside the same Suha-derived page system.

## Excluded material

No original purchased ZIP, e-commerce storefront demo, product inventory, third-party checkout, template demo authentication, unused product photograph, original font file, private WiseStay requirements document, purchase code or customer scan is committed. The user-supplied WiseStay logo is resized for the end-product header. Source distribution/licence terms remain the owner’s release review responsibility; there is no invented MIT relicensing of Suha.
