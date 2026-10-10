# Frontend patterns

Sources: PRD §7 (cross-cutting UI patterns), §8 (module views), §11 (routes), §14 (a11y, responsive,
i18n); wireframes in `resources/wireframes/*.png` and the clickable mockups in
`resources/example/*.html`; user decisions DU-01 (mock layer), DU-02 (shadcn MCP), P2 (multi-rate
invoices), P5 (portal access keys), P9 (brand = wireframes), OP-04, OP-06 (pdf.js). Invariant ids refer
to `conventions.md`.

## 0. shadcn MCP rule (DU-02, invariant C3)

Every UI package — and every UI package spec in `TASK.md` carries the line **"Use the shadcn MCP"**:

1. Before adding or composing a component, query the shadcn MCP (`mcp__shadcn`) for the registry item
   and its usage example (e.g. `sidebar`, `data-table` example, `command`, `chart`, `calendar`,
   `sheet`, `toggle-group`, `breadcrumb`, `hover-card`, `resizable`, `input-otp`).
2. Install with the pinned CLI: `pnpm exec shadcn add <item>`. Never copy component source by hand,
   never use `npx shadcn@latest`.
3. If the registry provides it, do not hand-write it. Compose registry components into project
   components (`src/components/ui/<kit>/`, `src/components/patterns/`, `src/features/*/components/`).
4. Edits to generated files in `src/components/ui/` are limited to theme tokens and i18n of built-in
   strings; mention each edit in the package report.
5. The Code Reviewer checks for hand-rolled equivalents of registry items.

## 1. Visual language and brand (P9: the wireframes are the brand)

There is no separate brand manual. The brand identity — app shell, portal and print letterhead — is the
one in `resources/wireframes/` and `resources/example/`.

- **Look.** Monochrome, high-contrast: ink-black primary (`#0E0E12`), soft canvas (`#F3F4F8`), white
  surfaces, light strokes (`#E8E8EE`), secondary ink `#55555F`, muted `#8E8E9A`; status colors only in
  badges and alerts. Rounded cards (~16 px radius), subtle shadows. Font **Inter** with tabular numerals
  (`tnum`). Translate these into shadcn CSS variables (`--background`, `--card`, `--primary`, `--muted`,
  `--border`, chart and sidebar tokens) for **light and dark**; dark mode is a first-class theme.
- **Logo.** The black circular "W" mark + "WeDevs Core" (app) / "WeDevs" (portal, print), as drawn in the
  wireframes.
- **Status badges.** One `StatusBadge` component maps every enum value to a tone (neutral, info, success,
  warning, danger) and an i18n label from the `enums` namespace. Overdue = danger; partial = neutral with
  secondary "Pago parcial" indicator (§9.4).
- **Numbers.** Money right-aligned with tabular figures, formatted by `formatMoney` with `Intl` per
  locale (`$1.350,00` in ES, `$1,350.00` in EN). Negative/overdue amounts in the danger tone.
- **Wireframe elements not built (OP-04, user decision):** live counters on the public sign-in page
  ("48 clientes · 23 proyectos · 1.284 eventos") are **removed**; "Verificación SAT / IRS OK" on client
  detail and the "Respaldo diario" footer pill are omitted. The topbar BCV rate chip **is** built (reads
  `ExchangeRate`, links to `/settings/rates`).

### 1a. Icons: Material Symbols → lucide

The mockups use Material Symbols; the app uses **lucide-react only** (PRD §6.2). Use this mapping
(verify each name against the pinned lucide version; if renamed, use its current name). Graph node
icons are fixed by PRD §8.12.2 and override this table.

| Material Symbol | lucide | Where |
|---|---|---|
| `dashboard` | `LayoutDashboard` | sidebar Inicio |
| `domain` | `Building2` | clients |
| `folder_special` | `FolderKanban` | projects |
| `receipt_long`, `receipt` | `Receipt` | invoices |
| `request_quote` | `ReceiptText` | quotes/proposals doc type |
| `payments` | `Banknote` | payments |
| `credit_card` | `CreditCard` | expenses |
| `account_balance` | `Landmark` | accounts |
| `account_balance_wallet` | `Wallet` | wallet accounts |
| `attach_money` | `DollarSign` | USD accounts |
| `currency_bitcoin` | `Bitcoin` | crypto accounts |
| `description` | `FileText` | documents |
| `article` | `ScrollText` | markdown/web document |
| `sticky_note_2` | `StickyNote` | notes |
| `notes` | `NotebookText` | note excerpt |
| `edit_note` | `NotebookPen` | markdown format option |
| `hub` | `Network` | graph |
| `bar_chart`, `insert_chart` | `ChartColumn` | reports, "Resumen" toggle |
| `table_chart` | `Table` | "Tabla" toggle |
| `view_quilt` | `PanelsTopLeft` | "Detalle" toggle |
| `history` | `History` | activity, version history |
| `settings` | `Settings` | settings |
| `logout` | `LogOut` | sign out |
| `first_page` | `PanelLeftClose` | collapse sidebar |
| `search` | `Search` | search |
| `schedule` | `Clock` | rate chip, dates |
| `notifications` | `Bell` | alerts bell |
| `dark_mode` | `Moon` (and `Sun` for light) | theme toggle |
| `person` | `User` | user, contact |
| `group` | `Users` | active users |
| `contacts` | `Contact` | contacts card |
| `badge` | `IdCard` | tax data |
| `keyboard_arrow_down`, `arrow_drop_down`, `expand_more` | `ChevronDown` | dropdowns |
| `unfold_more` | `ChevronsUpDown` | sortable headers, selects |
| `chevron_left` / `chevron_right` | `ChevronLeft` / `ChevronRight` | pagination, rows |
| `expand_circle_down` | `CircleChevronDown` | expand node |
| `arrow_back` | `ArrowLeft` | back links |
| `arrow_forward`, `arrow_right_alt` | `ArrowRight` | "Ver todas", diffs |
| `arrow_outward` | `ArrowUpRight` | KPI card link |
| `open_in_new` | `ExternalLink` | open link |
| `share` | `Share2` | share documents |
| `edit` | `Pencil` | edit |
| `more_horiz` / `more_vert` | `Ellipsis` / `EllipsisVertical` | more menus |
| `add` / `remove` | `Plus` / `Minus` | new, zoom |
| `close` | `X` | close, remove chip |
| `check` | `Check` | selected |
| `check_circle` | `CircleCheck` | success, "Listo" |
| `task_alt` | `CircleCheckBig` | installment to bill |
| `verified` | `BadgeCheck` | version pill |
| `verified_user` | `ShieldCheck` | NDA, verify payment |
| `warning` | `TriangleAlert` | overdue alert |
| `lock` | `Lock` | private link, locked document (P5), immutable log |
| `push_pin` | `Pin` | pinned note |
| `attachment` | `Paperclip` | attachments |
| `link` | `Link` | link format, links |
| `upload_file` | `FileUp` | file format option |
| `cloud_upload` | `CloudUpload` | drop zone |
| `file_download`, `download` | `Download` | export, download |
| `delete` | `Trash2` | remove file |
| `calendar_today` | `Calendar` | date fields |
| `event_repeat` | `CalendarSync` | expiry/alert fields |
| `gavel` | `Gavel` | legal documents |
| `timeline` | `TrendingUp` | roadmap doc type |
| `filter_alt` | `Funnel` | graph filters |
| `tune` | `SlidersHorizontal` | columns config |
| `center_focus_strong` | `Focus` | fit view |
| `restart_alt` | `RotateCcw` | reset layout |
| `map` | `Map` | minimap |
| `sync` | `RefreshCw` | recalculated metric |
| `bolt` | `Zap` | events stat |
| `smart_toy` | `Bot` | system actor |
| `public` | `Globe` | public portal actor |
| `memory` | `Cpu` | system job / technology |
| `mail` / `call` | `Mail` / `Phone` | contact actions |

## 2. Application shell (PRD §7.1) — wireframes 4.2, 4.4, 4.5

- **Root layout** wires providers: `NextIntlClientProvider`, `ThemeProvider` (next-themes, `class`
  strategy), `NuqsAdapter`, `Toaster` (sonner), `TooltipProvider`.
- **`(app)` layout**: shadcn `sidebar` (collapsible, icon mode) + topbar + content + footer.
- **Sidebar** (config in `src/config/nav.ts`, the single source for sidebar, breadcrumbs and Cmd+K
  navigation): `Inicio` (`/dashboard`); *Comercial*: Clientes, Proyectos; *Finanzas*: Facturas, Pagos,
  Gastos, Cuentas; *Conocimiento*: Documentos, Notas; *Análisis*: Grafo, Reportes, Actividad; footer:
  Configuración + user block (avatar, name, role, sign-out). Items hidden when `can()` denies read for
  the current role (cosmetic, C13). Count badges (e.g. overdue invoices) come from the alerts query.
- **Topbar**: breadcrumbs, search trigger with `⌘K` hint, BCV rate chip ("Tasa BCV · 1 USD = Bs.
  755,16"), alerts bell with counter, locale switch (ES/EN), theme toggle (light/dark/system), user menu
  (Clerk `UserButton` in Hito 2; in Hito 1 a mock menu with "View as role" and "Reset mock data", both
  marked MOCK).
- **Footer**: "© {year} WeDevs · Uso interno", app version, and in Hito 1 a visible **"Mock data"** badge.
- `/` redirects to `/dashboard`. Unknown routes inside `(app)` render an in-shell not-found page.

## 3. Module navigation: Overview → Table → Detail (PRD §7.1, §7.2, §11)

| Route | Screen | Notes |
|---|---|---|
| `/<module>` | Overview | Module KPIs, recent items, module alerts, quick actions |
| `/<module>/list` | Table | Full data-table |
| `/<module>/new` | Create form | Accepts prefill query params (`?clientId=`, `?installments=`, `?invoiceId=`) |
| `/<module>/[id]` | Detail | Tabs selected with `?tab=` |
| `/<module>/[id]/edit` | Edit form | |
| `/<module>/[id]/graph` | Entity graph | Same header as detail, "Detalle \| Grafo" toggle on "Grafo" |

- **Overview/Table toggle**: a segmented control "Resumen | Tabla" switches between `/<module>` and
  `/<module>/list` (wireframe 4.4).
- **Page header**: title + count badge, subtitle, primary action ("Nuevo cliente") and secondary
  ("Exportar CSV").
- Module-specific routes (PRD §11): `/projects/[id]/billing`; `/expenses/recurring[/new|/[id]]`;
  `/accounts/[id]` (ledger), `/accounts/transfers/new`, `/accounts/movements/new` (accounts have no
  `/list`; the overview is the card grid); `/documents/[id]/editor`,
  `/documents/[id]/versions/[versionId]`, `/documents/shares[/[id]]`; `/notes`, `/notes/new`,
  `/notes/[id]`; `/graph`; `/reports`, `/reports/[report]`; `/activity`; `/settings/<section>` for
  `company`, `users`, `preferences`, `currencies`, `rates`, `fiscal`, `payment-methods`,
  `technologies`, `document-types`, `expense-categories`, `tags`, `trash`.

## 4. Detail view (PRD §7.2) — wireframes 4.5, 4.10

- **Header** (`DetailHeader`): back link, avatar/initials or entity icon, code chip (`CLI-0007`), name,
  status badge, tags, meta line, the always-visible **Detalle | Grafo** toggle, "Compartir documentos"
  where applicable, "Editar", and a "More" menu (Archive / Void / Restore per §7.7).
- **Side panel**: key data and metrics (e.g. the dark "Estado financiero" card).
- **Tabs** (`DetailTabs`, `?tab=` via nuqs) with counts. Every entity has *Notas*, *Documentos*,
  *Actividad*; the PRD's "Grafo" tab is the header toggle to `/[id]/graph`.
- **Related tabs** show a mini-table and a "+ Nuevo" action that pre-links the current record. Shared
  cross-entity tabs: `EntityNotesTab`, `EntityDocumentsTab` (category chips + table + "Adjuntar
  documento" sheet, wireframe 4.6), `EntityActivityTab`.
- Archived records render with an "Archived" banner and a Restore action (Owner/Admin).

## 5. Tables (PRD §7.3) — wireframe 4.4

One shared `DataTable` (TanStack Table over shadcn `table`, following the registry's data-table
example):

- **Server-side pagination** 25/50/100, sorting, faceted filters (status, tags, currency, date range,
  client, project, technology — per entity) as "+ Estado" buttons that become chips, "Limpiar", debounced
  text search.
- All table state in the URL through `nuqs`, parsed with `listQuerySchema`, passed to `queries.ts`.
- **Configurable columns** (visibility, order, width) persisted per user and table (key
  `table:<tableId>:columns`; mock store in Hito 1, `UserPreference` in Hito 2).
- **Multi-select** with bulk actions (tag, archive, export).
- **CSV export** of the full filtered set (≤ 10,000 rows), visible columns only, UTF-8 with BOM, logged
  as `EXPORT` (Hito 2). Never built from the visible page only.
- **Empty state** with CTA; **skeletons** while loading.
- "Mostrar archivados" toggle, Owner/Admin only.

## 6. Forms (PRD §7.4) — wireframe 4.6

- Full-page forms at `/new` and `/[id]/edit` (`FormPage`); quick-creates in a `Sheet` or `Dialog`.
- react-hook-form + `zodResolver(schema)` with the **same** schema the action parses (C8); server
  `fieldErrors` mapped back onto fields.
- **Unsaved-changes guard** on dirty forms.
- On success: toast + navigate to detail; on `CONFLICT` show the error with a link to the existing
  record (HU-03 CA3); non-blocking warnings inline.
- **`MoneyInput`**: currency + amount as a decimal string; live USD equivalent via `lib/money` (C15).
- **`RateInput`**: prefill per §9.2 + DT-67 (exact → latest previous with "Usando tasa del dd/mm" → manual; source selector, BCV default),
  editable, 8 decimals, > 10 % deviation warning; USD fixed at 1.
- **Invoice lines (P2)**: an editable line grid — description, project, installment, quantity, unit
  price, line discount, **VAT rate select** (the allowed rates from fiscal settings: 16 %, 8 %, 0 %, plus
  "Exento"), computed line net. Below it, a live totals block from `lib/finance`: subtotal, discount,
  exempt amount, **one row per VAT rate** (base and IVA, each IVA adjustable ±0.01), total, withholdings,
  receivable, USD snapshot.
- **Relational comboboxes** (`AsyncCombobox`): async search through a read action, keyboard navigable,
  optional "Crear nuevo" inline. Multi-select variant for N:M.
- **Dates**: `calendar` + `popover` date field in `America/Caracas`; emits `YYYY-MM-DD`.
- **Uploader** (wireframe 4.6): drop zone + file list through an `UploadAdapter` (`requestUpload`,
  `put`, `confirmUpload`); Hito 1 mock adapter, Hito 2 presigned adapter; client-side allowlist and size
  (25 MB general, 10 MB payment receipts — C23).
- Other inputs: phone (E.164), country combobox with flags, tags multi-select with inline creation,
  Tiptap editor, markdown editor.

## 7. Cmd+K global search (PRD §7.6)

- shadcn `command` in a dialog, `⌘K` / `Ctrl+K` and the topbar trigger.
- Results grouped by entity type (icon, code, title, subtitle, status); prefixes `c:` `p:` `f:` `d:`
  `n:`; quick actions filtered by `can()`; recently visited records; exact code first (HU-26 CA3).
- Hito 1: dialog with navigation and quick actions in H1-B1; results over the mock search in H1-B5.

## 8. Alerts (PRD §7.9)

- Bell with counter + popover panel (icon, title, subtitle, badge or action such as "Verificar"),
  "Marcar leídas", per-alert dismiss and snooze (mock store in Hito 1, `AlertDismissal` in Hito 2).
- Computed live by a query. The nine alert types of §7.9. The same `AlertList` renders in the bell, the
  dashboard and each module overview.

## 9. Dashboard, overviews, reports (PRD §8.1, §8.13) — wireframe 4.2

- Dashboard: greeting + date, period selector (Mes / Trimestre / Año), export; KPI cards with variation;
  dark "Saldo en cuentas" card; 12-month income vs expenses bar chart with MRR chip; panels of §8.1.
  Member/Viewer see a version without financial data (§11).
- Charts via shadcn `chart`; each report chart has a collapsible data table and CSV export. KPI cards
  have value, variation and a 12-month sparkline and open the detailed report. "Impuestos registrados"
  shows IVA **per rate** (P2).
- All money in USD from snapshots (C16).

## 10. Graph (PRD §8.12) — wireframe 4.10

- React Flow canvas with dotted background, zoom controls, fit, minimap, fullscreen, export PNG/SVG,
  legend, filter card, layout switch Radial / Jerárquico / Fuerzas, in-graph search, focus mode, hover
  card (300 ms), selection side panel, "+N más" beyond 50 neighbours.
- Node cards from shadcn badges/avatars + lucide icons with the colors of §8.12.2 as theme tokens.
  Layouts in a Web Worker. Contract exactly §8.12.5 (`src/lib/validators/graph.ts`).
- Keyboard alternative: a node list view (PRD §14).

## 11. Documents, editor, PDF viewer and portal (PRD §8.9, §8.11) — wireframes 4.6, 4.8, 4.9

- **Markdown editor** (`/documents/[id]/editor`, full screen): top bar (back, breadcrumbs, title, code,
  status, autosave indicator, current version, history, print, "Publicar versión vN+1"), formatting
  toolbar, mode switch Editor / Dividido / Vista previa (`resizable`), CodeMirror 6 pane, sanitized
  preview through `MarkdownView` (C4), status bar. Autosave after 5 s of inactivity to the draft.
- **PDF viewer (OP-06)**: shared `PdfViewer` kit component on **pdf.js** with the wireframe 4.8 toolbar
  (page x / y, zoom − 100 % +, download, fullscreen), lazy-loaded, worker served from the app origin.
  Used in the portal, the invoice "Archivo" tab, payment receipts and the document viewer.
- **Print**: "Imprimir / Guardar como PDF" with a print stylesheet and the WeDevs letterhead as in the
  wireframe (P9).
- **Portal** (`/s/[token]`, outside `(app)`, no auth) with the wireframes' aesthetic as the brand image
  (P5/P9): brand header with "Enlace privado" pill and ES/EN switch, "Documentos compartidos" eyebrow,
  title, message, client, shared date, availability date; document cards (type, version, format/size,
  status, "Ver" / "Descargar"); viewer panel (pdf.js PDF, sanitized markdown, image, external link
  button); footer "Este enlace es personal. No lo reenvíes." + © line. Mobile layout per wireframe 4.8.
- **Access keys (P5)**: a key-protected document card shows a `Lock` icon and "Requiere clave"; "Ver" and
  "Descargar" are replaced by "Desbloquear", which opens a dialog with a masked key input (consult the
  MCP for `input-otp` vs a password `input`), submit, error message for a wrong key, and a lockout state
  ("Demasiados intentos, vuelve a intentarlo en 15 minutos"). After unlocking, the card behaves normally
  for the rest of the visit. Keys never appear in URLs. The unlock action is built with
  `definePublicAction` (C10).
- **Share link management**: create from a document, client or project; per-document "Requiere clave de
  acceso" toggle with "Generar clave" (shown once with copy button and the warning that it cannot be
  shown again) and "Regenerar clave"; version pinning per document; QR, revoke, expiry, counters
  (views, downloads, failed unlocks) and access table.
- Invalid/revoked/expired token → generic "Enlace no disponible" page with status 404 (C22). Portal
  locale comes from the share link, switchable by the visitor.

## 12. Notes (PRD §8.10) — wireframe 4.5

- Feed of cards: author avatar, author · date, pin, title, rich-text preview (expandable), tags,
  attachment chips. Pinned on top. Tiptap editor with headings, lists, task lists, links, code, quotes,
  tables and pasted images (uploaded as attachments).

## 13. Activity (PRD §8.14) — wireframe 4.7

- `/activity`: stat cards, filters, list grouped by day (time, actor — user avatar, "Sistema",
  "Portal público" —, action badge, entity code chip, summary); detail side panel with field diffs
  (before struck through → after), technical context (action, masked IP, browser, event id), link to the
  entity, the immutability note; "Cargar más".
- The entity *Actividad* tab reuses the same components.

## 14. Sign-in (PRD §4.2) — wireframe 4.1

- Split layout: dark brand panel (logo, "Acceso restringido" pill, headline, tagline, decorative graph
  illustration) + sign-in card ("Continuar con Google", email + "Continuar con correo", verification-code
  note). **No counters or any data** on this public page (OP-04, user decision).
- Hito 1: mock card that navigates to `/dashboard`. Hito 2: Clerk `<SignIn />` styled through Clerk
  `appearance` to match (IOU-05).

## 15. i18n and theme (PRD §7.8, HU-30)

- `next-intl` without locale routing. Locale from the `NEXT_LOCALE` cookie (then the user preference in
  Hito 2), default `es`. Changing it sets the cookie and refreshes; numbers/dates reformat (HU-30 CA1).
- Messages split by **namespace** files `src/i18n/messages/{es,en}/<namespace>.json`, merged by
  `src/i18n/request.ts` from the fixed list in `src/i18n/namespaces.ts` (DT-31). Each module package owns
  its namespace pair; `common`, `enums`, `validation` have a declared owner per wave. Keys `camelCase`
  nested by screen.
- Enum labels: `enums.<EnumName>.<VALUE>`. Zod messages: `validation.*`.
- Format numbers, money and dates with `next-intl` / `Intl`; display time zone from the user preference
  (default `America/Caracas`, DT-43).
- Theme: next-themes light/dark/system, class strategy; persisted locally in Hito 1 and on `User.theme`
  in Hito 2. No flash of the wrong theme.

## 16. Mock layer, from the UI's point of view (DU-01, C7, C9)

```
page.tsx (RSC) ──▶ features/<m>/queries.ts ──▶ services fn(ctx, input)
client form    ──▶ features/<m>/actions.ts (defineAction | definePublicAction for the portal) ──▶ services
                                   │
          Hito 1: import * as svc from '@/mocks/services/<m>'      (ctx.db = mock store)
          Hito 2: import * as svc from '@/server/services/<m>.service' (ctx.db = Prisma)
```

- Screens never know which implementation runs. They import only `queries.ts`, `actions.ts`, validator
  types and UI components.
- `queries.ts` builds `ctx` with `getServiceContext()` (`src/server/context.ts`) and calls the service.
- Routes reading data render dynamically; no static caching of mock data.
- When a Hito 2 block swaps a module, the only UI-adjacent edits allowed are the import lines in
  `queries.ts`/`actions.ts` and the deletion of that module's mock files. Anything else means the
  contract was wrong: report it.

## 17. Responsive and accessibility (PRD §14)

- Desktop first; tablet fully usable; on mobile the sidebar becomes a sheet, tables scroll horizontally
  with code and name pinned, detail tabs scroll; the portal is fully usable on mobile.
- Keyboard: every action reachable, visible focus, dialogs trap focus, Cmd+K accessible, graph node-list
  alternative, PDF viewer toolbar operable by keyboard.
- Labels on all inputs and icon buttons (`aria-label` from i18n, C1). Contrast AA in both themes.

## 18. Wireframe index

| Wireframe | Mockup | Screens it governs |
|---|---|---|
| `4.1_login_iniciar_sesi_n.png` | `login.html` | `(auth)/sign-in` (without counters) |
| `4.2_dashboard_inicio.png` | `dashboard.html` | shell (sidebar, topbar, footer), `/dashboard` |
| `4.4_clients_table_clientes.png` | `clientes.html` | every `/<module>/list` |
| `4.5_client_detail_kairos_studio_llc.png` | `cliente-detalle.html` | every detail page |
| `4.6_document_attachment_kairos_studio_llc.png` | `documentos.html` | `EntityDocumentsTab`, attach sheet, uploader |
| `4.7_activity_log_actividad.png` | `actividad.html` | `/activity`, `EntityActivityTab` |
| `4.8_public_document_portal_portal_de_clientes.png` | `portal.html` | `/s/[token]` (desktop and mobile), `PdfViewer` toolbar |
| `4.9_markdown_document_editor_doc_0018.png` | `editor.html` | `/documents/[id]/editor` |
| `4.10_relational_graph_kairos_studio_llc.png` | `grafo.html` | `/<entity>/[id]/graph`, `/graph` |

Screens without a wireframe (overviews, finance forms, billing editor, accounts ledger, reports,
settings, trash, shares, unlock dialog) are composed from these same patterns and brand; the PRD §8
section of each module defines their fields, columns and tabs.
