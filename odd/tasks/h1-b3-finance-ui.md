# H1-B3 — Finance UI (ODD feature)

H1-B3 Finance UI over mocks: finance catalogs, accounts, billing plans, invoices with multi-rate lines (DT-44), payments + allocations, expenses + recurring, finance tabs in client/project detail.
Branch `batch/h1-b3-finance-ui` from `main` (all earlier branches unified into `main`, L3) · delivery `ask-on-risk` (forecast ≫ 400 lines → chain strategy asked before the commit that crosses it; push/PR deferred to end of Hito 1, DT-69) · runner: Vitest (`pnpm --dir fe test`), Playwright for HU-09/11/13 E2E · gate per task: `pnpm lint && typecheck && test && i18n:check` (build at wave close).

## Specs
- **S0** Scope (L1): "pasamos a B3". Source of truth: `docs/TASK.md` "H1-B3 — Finance UI (outline)", PRD §8.4–§8.8, §8.15, §9, §10.2, §11 finance routes; DT-44, DT-18, DT-24, DT-25, DT-29, DT-34, DT-41, DT-67, DT-70, DT-73. Invariants C1–C10, C15, C16 (shape), C17, C19 (shape), C25.
- **S1 — C17 calculators** (`conventions.md:144`): "Financial formulas are implemented once, in `src/lib/finance/`. Pure functions with ≥ 90 % coverage for: invoice totals with **multiple VAT rates per invoice** … invoice status (§9.4, `VENCIDA` wins over partial payment), cross-currency allocation (§9.5, settled when balance ≤ 0.01), IGTF and fees (§9.6, IGTF is not income, fees are not duplicated as expenses), account balance (§9.7, `accountAmount` when currencies differ), installment status and template splits (§8.4.2), recurring normalization to month (§8.13.2). Mock services (H1), real services (H2) and live form totals all call them; nobody re-derives a formula inline."
- **S2 — DT-44**: "Invoices are split into lines; each line has its own VAT rate (16 %, 8 %, 0 %, or exempt) and an optional line discount; header totals are derived: subtotal, discount, exempt amount, base and IVA **per rate** (IVA adjustable ±0.01 per rate), withholdings, total, receivable, USD snapshots." Tester case: "±0.01 adjustment accepted and 0.02 rejected"; "an invoice with lines at 16 %, 8 %, 0 % and exempt → per-rate bases/IVA and total match C17".
- **S3 — HU-09** Definir esquema con plantilla:
  - CA1: Si elijo "40/30/30" con un monto contratado de 10 000 USD, se generan cuotas de 4 000, 3 000 y 3 000.
  - CA2: Si la suma de las cuotas no `AJUSTE` difiere del monto contratado en más de 0,01, se muestra un aviso persistente.
  - CA3: Una cuota ya facturada no permite cambiar su monto ni su moneda.
- **S4 — HU-10** Mantenimiento recurrente:
  - CA1: Un cobro mensual con día 5 y 7 días de anticipación genera la cuota del periodo el día 28 o 29 del mes anterior.
  - CA2: Ejecutar la tarea dos veces el mismo día no duplica cuotas.
  - CA3: Un cobro pausado no genera cuotas.
  - CA4: La alerta "Cuota por facturar" aparece en la campana y en el dashboard.
- **S5 — HU-11** Registrar factura desde cuotas:
  - CA1: Al elegir el cliente se listan las cuotas `PENDIENTE` de todos sus proyectos, y al seleccionarlas se crean las líneas correspondientes.
  - CA2: Los totales (base, IVA, total, retenciones, por cobrar y USD) se calculan en vivo según §9.3. *(as amended by DT-44)*
  - CA3: El número de factura es único entre las facturas no archivadas.
  - CA4: Puedo adjuntar el PDF de la factura real y verlo en el detalle.
  - CA5: Al guardar, las cuotas seleccionadas pasan a `FACTURADA`.
- **S6 — HU-12** Estado automático:
  - CA1: Una factura sin pagos y no vencida está `EMITIDA`.
  - CA2: Con un pago confirmado menor que el saldo pasa a `PARCIAL`.
  - CA3: Con el saldo ≤ 0,01 pasa a `PAGADA`.
  - CA4: Si vence con saldo pendiente, la tarea diaria la marca `VENCIDA`.
  - CA5: Anular exige un motivo y solo se permite sin asignaciones activas.
- **S7 — HU-13** Registrar pago y asignarlo:
  - CA1: El formulario exige el cliente, la fecha, la cuenta, el método, la moneda, el monto, la tasa y la referencia (si el método la requiere).
  - CA2: Para el caso de un pago de 100 USD con IGTF de 3 y comisión de 0: el monto asignable es 97; el neto acreditado en la cuenta es 100.
  - CA3: La suma de las asignaciones no puede superar el monto asignable, y cada asignación no puede superar el saldo de su factura.
  - CA4: Si un pago está en VES y la factura en USD, el sistema propone el monto en USD con la tasa del día del pago, y el usuario lo puede editar.
  - CA5: Lo que no se asigna queda como saldo a favor visible en el cliente y en el pago.
  - CA6: Si existe otro pago con la misma referencia, el mismo método y la misma cuenta, se muestra un aviso de posible duplicado.
- **S8 — HU-14** Comprobante:
  - CA1: Se aceptan PDF, PNG, JPG y WEBP de hasta 10 MB, que se suben directamente al bucket. *(H1: mock upload adapter)*
  - CA2: El comprobante se puede ver en el detalle sin descargarlo.
- **S9 — HU-15** Saldos de cuentas:
  - CA1: El saldo cumple la fórmula de §9.7.
  - CA2: El libro muestra cada movimiento con su saldo corrido.
  - CA3: Una conciliación con diferencia sugiere un movimiento `AJUSTE` por ese monto.
- **S10 — HU-16** Transferencia entre cuentas:
  - CA1: Una transferencia de 100 USD desde Zelle a Binance (USDT), recibiendo 99 USDT, descuenta 100 de la cuenta origen y suma 99 a la cuenta destino.
  - CA2: No se puede transferir de una cuenta a sí misma.
- **S11 — HU-17** Gastos recurrentes:
  - CA1: Una suscripción mensual activa genera un gasto `PENDIENTE` por periodo, sin duplicados.
  - CA2: "Marcar como pagado" exige la cuenta y permite ajustar el monto real y la tasa.
  - CA3: Un gasto imputado a un proyecto reduce el margen de ese proyecto.
- **S12 — Finance catalogs** (outline W1): "currencies, rates with quick daily load and CSV import, fiscal incl. allowed VAT rates, payment methods, expense categories" at `/settings/{currencies,rates,fiscal,payment-methods,expense-categories}`; several rates per day, one per source, prefill BCV (DT-67); IGTF proposal rule DT-70.
- **S13 — Routes** (PRD §11, DT-25 overview ≠ list): `/projects/[id]/billing`; `/invoices`, `/invoices/list`, `/invoices/new` (`?clientId=`, `?installments=`), `/invoices/[id]`, `/edit`, `/graph`; `/payments` … `/payments/new` (`?invoiceId=`); `/expenses` … `/expenses/recurring`, `/expenses/recurring/new`, `/expenses/recurring/[id]`; `/accounts`, `/accounts/new`, `/accounts/[id]`, `/edit`, `/accounts/transfers/new`, `/accounts/movements/new`. *`/graph` routes: link only, graph UI is H1-B5.*
- **S14 — Carried from H1-B2** (TASK.md): "`projectHeadline` delegates to `lib/finance` per §8.4.4 (proportional collected, adjustments, `toInvoice` only `FIJO`/`MIXTO`)"; "the client financial card calls `getClientFinancials` only when `canSeeFinancials`"; "alerts leave out archived finance rows once the finance DTOs carry `archivedAt`"; HU-29 CA1 invoice-total diff; note link picker gains invoice/payment/expense; un-skip the project archive `INTEGRITY_LOCK` E2E once billing data exists.
- **D1 (decided, L3)**: "the USD value of a non-USD contract (§10 has no snapshot on the billing plan)" → snapshot `contractedUsd` + rate at plan save, never recomputed (C16). Applies to T5 and T9.

## Tasks
| ID | Specs | Work | Route | Status |
|---|---|---|---|---|
| T1 | S1, S2, S3-CA1/2, S6, S7-CA2/3/4, S9-CA1, S10-CA1 | `fe/src/lib/finance/**` pure calculators, test-first per CA, ≥ 90 % coverage | inline | done — RED 6/6 files missing module → GREEN 46/46; coverage 100 % lines, 95.94 % branches; lint + tsc clean |
| T2 | S1, S12 | `src/mocks/derive-finance.ts` registered on the store `DeriveHook` seam (`store.ts:159`); seed fixtures (currencies, rates, accounts, plans, multi-rate invoices, payments, expenses) computed through T1 | inline | pending |
| T3 | S12 | finance catalog settings screens | inline | pending |
| T4 | S9, S10, S13 | accounts slice: overview, detail ledger with running balance, transfers, movements, reconciliation → `AJUSTE` | delegated (parallel W2) | pending |
| T5 | S3, S4, S13, D1 | billing slice `/projects/[id]/billing`: templates, installments, recurring charges, "Cuota por facturar" alert data | delegated (parallel W2) | pending |
| T6 | S2, S5, S6, S13 | invoices slice: overview, list, form with line grid (per-line VAT incl. "Exento", line discount), "Facturar cuotas", live per-rate totals, PDF "Archivo" tab, void | delegated (parallel W2) | pending |
| T7 | S7, S8, S13 | payments slice: allocations, IGTF proposal, duplicate warning, receipt viewer, saldo a favor | delegated (parallel W2) | pending |
| T8 | S11, S13 | expenses + recurring slice, "Marcar como pagado" | delegated (parallel W2) | pending |
| T9 | S14, D1 | wire finance tabs (`FinanceTabSlot` at `clients/[id]/page.tsx:100,105`, `projects/[id]/page.tsx:90,95,100`) and cards; replace `projectHeadline` placeholder (`mocks/services/projects.ts:120`); gate `getClientFinancials`; alerts `archivedAt`; note link picker | inline | pending |
| T10 | S2–S11 | verification: money scenarios, `lib/finance` coverage, E2E HU-09/11/13, i18n parity, build; independent verifier (money = high risk, item 6/3) | delegated (verifier) | pending |

Route evidence: T4–T8 are disjoint feature slices (own `features/<module>`, `app/(app)/<module>`, i18n namespace, derive-hook file) launched together → Writer trigger (a) parallelism; shared files (`store.ts`, nav config, `settings-nav.ts`) owned by the parent at the end (C25). Everything else inline. Safeguard 1: no persistent server + browser in the same worker.

## Log
- **L1** (2026-10-13, user): "bien, cerrada B2, pasamos a B3, prepara el plan segun la forma de trabajo de gentle-ai"
- **L2**: mapped state — `lib/finance` and `derive-finance.ts` missing; finance fixtures are typed empty arrays; validators exist (`lib/validators/{accounts,billing,invoices,payments,expenses,catalogs,settings,money}.ts`); finance routes fall through to `[...missing]`.
- **L3** (2026-10-13, user): "D1: recomendacion aprobada. Unica todos los cambios a main y continuamos luego de forma unificada" → pending work committed (`cb2a89d`, `c9d0ed8`, `22114a0`, `3b32533`, `17ba2fb`) and `main` fast-forwarded to `17ba2fb`; every batch branch is merged into `main`.
- **L4** (2026-10-13, user): "ya corri yo los test, todo en orden, procede" → branch `batch/h1-b3-finance-ui` cut from `main`; T1 done: `lib/finance/{invoice-totals,invoice-status,installments,recurring,payments,accounts}.ts` + barrel. Notes: §9.4 writes `balance <= 0.00` but §9.5/HU-12 CA3 say ≤ 0.01 → status uses `isSettled`; recurring generation creates only the period after the last existing one (no back-fill, §8.4.3).
- **Next**: T2.
