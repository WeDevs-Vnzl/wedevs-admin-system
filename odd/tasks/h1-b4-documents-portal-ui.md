# H1-B4 — Documents and portal UI (ODD feature)

H1-B4 over mocks: document categories/types settings, documents module, markdown editor, share links and the public portal `/s/[token]` with access keys (DT-45), `PdfViewer` (DT-50) and the WeDevs brand (DT-51).
Branch `batch/h1-b4-documents-portal-ui` from local `main` (`fec05c4`) · delivery `ask-on-risk` (forecast ≫ 400 lines; push/PR deferred to the end of Hito 1, DT-69) · runner: vitest (`fe/node_modules/.bin/vitest`) + Playwright E2E against the user's `next dev` on :3000.

## Specs
- **S0** Scope (L1): "inicia la planificacion de la implementacion de B4". Source of truth: `docs/TASK.md` "H1-B4 — Documents and portal UI (outline)" (:2988); PRD §8.9 (:816), §8.11 (:915), routes (:2545-2558), HU-18–HU-22 (:2710-2741), §14 (:2793); DT-45, DT-50, DT-51, DT-62 (`docs/rules/decisions.md`); wireframes 4.6, 4.8, 4.9 (`resources/wireframes/`) and `resources/example/{documentos,editor,portal}.html`. Contracts already fixed in `fe/src/lib/validators/{documents,document-types,shares}.ts`; keep their exported names.
- **S1 — Outline objective** (TASK.md:2990): "document categories/types settings, documents module, markdown editor, share links (create from document/client/project; per-document **access key** toggle with generate/regenerate shown once; list; detail with QR, revoke, counters incl. failed unlocks, access table), public portal `/s/[token]` over mock links with the wireframes' brand (DT-51), `PdfViewer`, **unlock dialog and lockout state** for key-protected documents (DT-45), generic 404 page, print view."
- **S2 — Markdown and sanitize**: PRD §8.9.3 "compatible con GitHub Flavored Markdown (tablas, listas de tareas, bloques de código con resaltado)"; HU-18 CA4 no scripts or iframes executed; §14 markdown always sanitized when rendered. Outline W1: "shared `MarkdownView` with `rehype-sanitize` + print stylesheet/letterhead".
- **S3 — Print** (PRD §8.9.5): "La vista markdown tiene la acción "Imprimir / Guardar como PDF", con hoja de estilos de impresión y membrete de WeDevs."
- **S4 — Document types settings**: `/settings/document-types`, categories and types CRUD; HU-21 (deactivate only when in use).
- **S5 — Versioning** (PRD §8.9.3):
  - "**Borrador con autoguardado.** Mientras se edita un documento markdown, el contenido se guarda automáticamente cada 5 segundos de inactividad en `draftContent`. El borrador no crea versión."
  - "**Publicar versión.** La acción "Publicar versión" crea una `DocumentVersion` inmutable con número incremental y nota de cambios opcional, y la marca como versión vigente."
  - "**Nueva versión de archivo o enlace.** Se crea con la acción "Subir nueva versión" o "Actualizar enlace"."
  - "**Historial.** El historial lista las versiones con autor, fecha y nota. Permite ver una versión, descargarla, compararla con la vigente (diff de texto, solo en markdown) y **restaurarla**. Restaurar crea una nueva versión copiando la elegida"
  - "**Bloqueo por firma.** Un documento `FIRMADO` no admite nuevas versiones."
- **S6 — Statuses** (PRD §8.9.4): "BORRADOR ⇄ EN_REVISION → APROBADO → ENVIADO → FIRMADO → VENCIDO (automático) / cualquiera (salvo VENCIDO) → ANULADO"; "`FIRMADO` solo existe en los tipos con firma. Al pasar a ese estado se exige la fecha de firma"; "Compartir un documento en el portal propone pasarlo a `ENVIADO` si estaba `APROBADO`."
- **S7 — Views** (PRD §8.9.5):
  - "**Overview:** documentos por categoría y estado, por vencer en los próximos 30, 60 y 90 días, recientes y borradores con más de 14 días sin cambios."
  - "**Tabla.** Columnas: código, título, categoría, tipo, estado, formato vigente, versión, vinculado a (chips), vencimiento, compartido (sí o no) y actualizado."
  - "**Detalle.** Pestañas: Contenido (visor según el formato, con el botón "Editar" en markdown), Versiones, Vínculos, Compartir (enlaces del portal que lo incluyen), Notas, Actividad, Grafo."
- **S8 — Share links** (PRD §8.11, `shares.ts`): 32-byte CSPRNG base64url token; each document pinned to a version or "always latest" (`versionId: null`); download allowed by default; ES/EN portal locale; optional expiry; revoke; counters `viewCount`, `downloadCount`, `unlockCount`, `failedUnlockCount`, `lastAccessedAt`; access table. Created from a document, a client or a project. Outline: "mock tokens from a CSPRNG, version pinning, access-key management; mock keys hashed even in the mock store".
- **S9 — Access keys** (DT-45, `shares.ts:45-49`): scrypt hash with per-key salt; clear key shown once (only in `generatedKeys` / `accessKey` results); constant-time compare; `UNLOCK_FAILED` / `UNLOCK` logged; lockout "after 5 failures per link/document/IP hash in 15 min"; key length 8–128; errors `ACCESS_KEY_INVALID`, `ACCESS_KEY_LOCKED`.
- **S10 — Portal** (PRD §8.11, DT-51, wireframe 4.8): WeDevs brand (logo, monochrome palette, Inter), title, message, document list (type, version, date), `PdfViewer` / `MarkdownView` viewers, download (markdown as `.md`, printable), unlock dialog and lockout state, mobile layout. Unknown, revoked or expired token → generic "Enlace no disponible" with 404 and no reason; headers `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`, `Cache-Control: private, no-store`. Public actions through `definePublicAction` (C22).
- **S11 — Carried findings** (TASK.md): 793/805/817 real PDF render and the pdf.js worker under Turbopack; 829 pdf-viewer zoom-reset accessible name (WCAG 2.5.3), fullscreen `aria-pressed` with a changing label, tests for the dynamic wrapper; 1103 m7 request-metadata placement; 1116 m-d parse the token with `shareTokenSchema` before `resolveToken`, m-e never leak a specific `NOT_FOUND` reason; 2491/2533 tab counts capped at 100, unlink confirmation without `{name}`; 2492 archived-target tests for DOCUMENT/NOTE; 2881 DOCUMENT link prefill; 3005 "`createDocument` with a file must be atomic (no version-less `BORRADOR` left linked when the upload fails); category chips filter and count over all documents (not one page capped at 100); `LINK`/`UNLINK` entries carry target metadata."
- **S12 — Tester** (TASK.md outline): "local E2E of HU-18 (autosave without version, publish N+1, compare, restore; script/iframe not executed), HU-19 UI, HU-20, HU-21, HU-22 CA2–CA4 and CA6 over mocks; key-protected document: view/download blocked until the correct key, wrong key error, lockout after 5 failures; portal mobile layout; PDF toolbar."

### Assumptions (accepted by the user, L3)
- **A1** `/documents/[id]/graph` and the Grafo tab belong to H1-B5 ("every `/<entity>/[id]/graph`"); here the tab links there.
- **A2** The H1 mock enforces the lockout in memory, per link/document/IP hash, so the Tester sees it (S12).
- **A3** The mock unlock state is an httpOnly cookie scoped to `/s/[token]`, signed with a non-secret dev constant; the real `SHARE_UNLOCK_SECRET` lands in H2-B5. Metadata (IP hash, user agent, cookie) is collected in `definePublicAction` and handed to the handler (closes m7).
- **A4** Portal download in H1 goes through a route handler `/api/s/[token]/files/[documentId]` serving bundled sample files from the mock store; H2-B5 swaps it for the presigned URL.
- **A5** Sharing several documents proposes `ENVIADO` once, listing every `APROBADO` document with one checkbox each.
- **A6** Code highlighting with `rehype-highlight` (L3).

## Tasks
| ID | Specs | Work | Route | Status |
|---|---|---|---|---|
| T1 | S2, S3 | `MarkdownView` (react-markdown + remark-gfm + rehype-sanitize; script/iframe stripped), print stylesheet + WeDevs letterhead | inline | pending |
| T2 | S4 | document categories/types: mock CRUD service + `/settings/document-types` (tables, forms, deactivate-only when in use) | inline | pending |
| T3 | S5, S6, S11 (3005) | documents mock services: the 11 missing `DocumentsService` names + fixtures; atomic `createDocument`, LINK/UNLINK target metadata | inline | pending |
| T4 | S7, S11 (2881) | `/documents` overview, `/documents/list` table, `/documents/new`, `/documents/[id]/edit` | inline | pending |
| T5 | S5, S6, S7, S11 (793–829) | `/documents/[id]` detail tabs, status changes, versions view/diff/restore, new file version / update link; real PDF render + worker check + pdf-viewer a11y fixes | inline | pending |
| T6 | S5 | `/documents/[id]/editor` split markdown editor (wireframe 4.9): autosave 5 s, publish N+1 with changelog, signature lock | inline | pending |
| T7 | S8, S9 | shares mock service + fixtures: CSPRNG tokens, version pinning, scrypt-hashed keys shown once, counters, access log | inline | pending |
| T8 | S6, S8, S9 | shares UI: `/documents/shares`, `/documents/shares/[id]` (QR, revoke, expiry, docs, keys, counters, access table), create dialog from document/client/project, `ENVIADO` proposal | inline | pending |
| T9 | S9, S10, S11 (1103, 1116) | portal `/s/[token]` + `definePublicAction` fixes, unlock dialog, lockout, generic 404, headers, download route, mobile | inline | pending |
| T10 | S11 (2491–2533) | documents tab: chips filter/count over all, unlink `{name}`, archived-target tests | inline | pending |
| T11 | S12, all | independent verifier (high risk: public surface and keys) + E2E per S12 | delegated (verifier) | pending |

Route evidence: no writer reason (units share `features/documents`, the mock store and i18n), so the parent writes inline following this logbook. T7–T9 are high risk (item 2: credentials and the public surface) → T11 verifier.

## Log
- **L1** (2026-10-14, user): "aprobado B3, inicia la planificacion de la implementacion de B4"
- **L2** Mapping (explorer, 2026-10-14): contracts complete in validators; mocks implement 5/16 `DocumentsService` names, only the two catalog reads for types/categories, no shares/portal service; `fixtures/shares.ts` empty stub; store already has documents, versions, links, shareLinks, shareDocumentKeys, shareAccessLogs; no `/documents*`, `/s/[token]` or `/api/s/*` routes; `/settings/document-types` is a `SectionPlaceholder`; `pdfjs-dist`, `rehype-sanitize`, `react-markdown`, `remark-gfm`, `qrcode`, `diff` installed; no syntax-highlight library installed (PRD asks "bloques de código con resaltado") → open question.
- **L3** (2026-10-14, user): "agrega rehype-highlight, desde ahora usa bun en vez de pnpm, A1-A5 aceptados, procede con T1 y T2 en paralelo". `rehype-highlight@7.0.2` added with `bun add` (package.json + `bun.lock`); vitest smoke 21/21. Note: CI (`.github/workflows/ci.yml`), `packageManager` and `pnpm-lock.yaml` still name pnpm; the lock no longer matches → to align before the end-of-Hito-1 push.
- **Next**: T1 and T2 in parallel (two writers, disjoint surfaces).
