import { z } from "./zod";
import {
  VALIDATION_MESSAGES,
  dateOnlySchema,
  idSchema,
  listQuerySchema,
  type Paginated,
} from "./common";
import { clientKindSchema, clientStatusSchema } from "./enums";
import { moneyAmountSchema } from "./money";
import { contactDetailSchema, e164PhoneSchema } from "./contacts";
import {
  bulkIdsSchema,
  facetOf,
  optionalHttpUrlSchema,
  optionalEmailSchema,
  optionalText,
  requiredText,
  tagChipSchema,
  timestampSchema,
  uniqueIds,
  withSortFields,
} from "./tags";
import { archivedRecordSchema } from "./trash";

/**
 * Clients (PRD §8.2). Money metrics are USD decimal strings (C15).
 *
 * Rules: `legalName` is required for `EMPRESA` (for `PERSONA` it defaults to the trade name); the tax id
 * is validated as an RIF (`V`/`E`/`J`/`G`/`P` + 8 digits + check digit) when the country is `VE`; the
 * country is ISO 3166-1 alpha-2; the phone is E.164; the status defaults to `PROSPECTO`. The pair
 * (tax id + country) is unique among non-archived clients (CONFLICT, enforced by the service).
 */

// ───────────────────────────── Country ─────────────────────────────

/** Officially assigned ISO 3166-1 alpha-2 codes (249). */
// prettier-ignore
export const COUNTRY_CODE_VALUES = [
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT", "AU", "AW", "AX", "AZ",
  "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ", "BR", "BS",
  "BT", "BV", "BW", "BY", "BZ", "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN",
  "CO", "CR", "CU", "CV", "CW", "CX", "CY", "CZ", "DE", "DJ", "DK", "DM", "DO", "DZ", "EC", "EE",
  "EG", "EH", "ER", "ES", "ET", "FI", "FJ", "FK", "FM", "FO", "FR", "GA", "GB", "GD", "GE", "GF",
  "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS", "GT", "GU", "GW", "GY", "HK", "HM",
  "HN", "HR", "HT", "HU", "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT", "JE", "JM",
  "JO", "JP", "KE", "KG", "KH", "KI", "KM", "KN", "KP", "KR", "KW", "KY", "KZ", "LA", "LB", "LC",
  "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY", "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK",
  "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ", "NA",
  "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ", "OM", "PA", "PE", "PF", "PG",
  "PH", "PK", "PL", "PM", "PN", "PR", "PS", "PT", "PW", "PY", "QA", "RE", "RO", "RS", "RU", "RW",
  "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS",
  "ST", "SV", "SX", "SY", "SZ", "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO",
  "TR", "TT", "TV", "TW", "TZ", "UA", "UG", "UM", "US", "UY", "UZ", "VA", "VC", "VE", "VG", "VI",
  "VN", "VU", "WF", "WS", "YE", "YT", "ZA", "ZM", "ZW",
] as const;

export const countryCodeSchema = z.enum(COUNTRY_CODE_VALUES);
export type CountryCode = z.infer<typeof countryCodeSchema>;

// ───────────────────────────── Tax id ─────────────────────────────

/** Venezuelan RIF: type letter, 8 digits and a check digit; dashes optional (`J-12345678-9`, `J123456789`). */
const VE_RIF_PATTERN = /^[VEJGP]-?\d{8}-?\d$/i;

export function isValidVeRif(value: string): boolean {
  return VE_RIF_PATTERN.test(value.trim());
}

/** Canonical RIF form `J-12345678-9`; the input is returned trimmed when it is not a RIF. */
export function normalizeVeRif(value: string): string {
  const trimmed = value.trim();
  if (!isValidVeRif(trimmed)) return trimmed;
  const compact = trimmed.replace(/-/g, "").toUpperCase();
  return `${compact.slice(0, 1)}-${compact.slice(1, 9)}-${compact.slice(9)}`;
}

/**
 * Validates `taxId` for the given country: an RIF for `VE`, free text (NIT, Tax ID, EIN…) otherwise.
 * Used by the client forms and by `clientFieldsSchema`'s cross-field check.
 */
export function isValidTaxIdFor(country: string, taxId: string): boolean {
  return country === "VE" ? isValidVeRif(taxId) : taxId.trim().length > 0;
}

// ───────────────────────────── Inputs ─────────────────────────────

const clientFieldsShape = {
  kind: clientKindSchema,
  tradeName: requiredText(120),
  /** Required for `EMPRESA`; for `PERSONA` the service stores the trade name when it is missing. */
  legalName: optionalText(160),
  taxId: requiredText(40),
  country: countryCodeSchema,
  address: requiredText(500),
  phone: e164PhoneSchema,
  email: optionalEmailSchema,
  website: optionalHttpUrlSchema,
  tagIds: uniqueIds({ max: 50 }).default([]),
};

function checkClientFields(
  value: { kind: string; legalName?: string | undefined; taxId: string; country: string },
  ctx: z.RefinementCtx,
): void {
  if (value.kind === "EMPRESA" && !value.legalName) {
    ctx.addIssue({ code: "custom", message: VALIDATION_MESSAGES.required, path: ["legalName"] });
  }
  if (!isValidTaxIdFor(value.country, value.taxId)) {
    ctx.addIssue({ code: "custom", message: VALIDATION_MESSAGES.invalidFormat, path: ["taxId"] });
  }
}

/** `createClient`. The code (`CLI-0001`) is allocated by the service. */
export const createClientInputSchema = z
  .object({ ...clientFieldsShape, status: clientStatusSchema.default("PROSPECTO") })
  .superRefine(checkClientFields);
export type CreateClientInput = z.infer<typeof createClientInputSchema>;
export type CreateClientFormValues = z.input<typeof createClientInputSchema>;

/** `updateClient`: the edit form submits every editable field; the status changes through `setClientStatus`. */
export const updateClientInputSchema = z
  .object({ id: idSchema, ...clientFieldsShape })
  .superRefine(checkClientFields);
export type UpdateClientInput = z.infer<typeof updateClientInputSchema>;
export type UpdateClientFormValues = z.input<typeof updateClientInputSchema>;

/** `setClientStatus`: the change is manual (PRD §8.2). */
export const setClientStatusInputSchema = z.object({
  id: idSchema,
  status: clientStatusSchema,
});
export type SetClientStatusInput = z.infer<typeof setClientStatusInputSchema>;

/**
 * `archiveClient`. A client with active projects or invoices needs `confirm: true`; archiving it also
 * archives its contacts (C19, PRD §7.7). Without confirmation the service answers INTEGRITY_LOCK.
 */
export const archiveClientInputSchema = z.object({
  id: idSchema,
  confirm: z.boolean().default(false),
});
export type ArchiveClientInput = z.infer<typeof archiveClientInputSchema>;

export const restoreClientInputSchema = z.object({ id: idSchema });
export type RestoreClientInput = z.infer<typeof restoreClientInputSchema>;

export const clientIdInputSchema = z.object({ id: idSchema });
export type ClientIdInput = z.infer<typeof clientIdInputSchema>;

/** Bulk archive from the table's selection (PRD §7.3). Same `confirm` rule as `archiveClient`. */
export const archiveClientsInputSchema = z.object({
  ids: bulkIdsSchema,
  confirm: z.boolean().default(false),
});
export type ArchiveClientsInput = z.infer<typeof archiveClientsInputSchema>;

// ───────────────────────────── Filters ─────────────────────────────

export const CLIENT_SORT_FIELDS = [
  "code",
  "tradeName",
  "kind",
  "country",
  "status",
  "projectCount",
  "totalInvoicedUsd",
  "receivableUsd",
  "lastActivityAt",
  "createdAt",
] as const;

export const clientFilterSchema = withSortFields(
  listQuerySchema.extend({
    status: facetOf(clientStatusSchema),
    kind: facetOf(clientKindSchema),
    country: facetOf(countryCodeSchema),
    tagId: facetOf(idSchema),
    /** Only clients with an overdue balance (overview shortcut). */
    hasOverdue: z.union([z.boolean(), z.stringbool()]).optional(),
    createdFrom: dateOnlySchema.optional(),
    createdTo: dateOnlySchema.optional(),
  }),
  CLIENT_SORT_FIELDS,
);
export type ClientFilter = z.infer<typeof clientFilterSchema>;
export type ClientFilterInput = z.input<typeof clientFilterSchema>;

// ───────────────────────────── DTOs ─────────────────────────────

/** USD amount that can be zero but not negative (totals). */
const usdTotalSchema = moneyAmountSchema({ sign: "nonNegative" });

/** Row of the clients table (`/clients/list`, PRD §8.2 "Tabla"). */
export const clientListRowSchema = z.object({
  id: idSchema,
  code: z.string(),
  tradeName: z.string(),
  kind: clientKindSchema,
  country: countryCodeSchema,
  status: clientStatusSchema,
  projectCount: z.number().int().nonnegative(),
  /** Total invoiced, USD snapshot sum (C16). */
  totalInvoicedUsd: usdTotalSchema,
  /** Receivable balance, USD snapshot sum. */
  receivableUsd: usdTotalSchema,
  tags: z.array(tagChipSchema),
  /** Last activity-log entry on the client or its records; `null` when there is none. */
  lastActivityAt: timestampSchema.nullable(),
  archivedAt: timestampSchema.nullable(),
});
export type ClientListRowDTO = z.infer<typeof clientListRowSchema>;

/** `getClientFinancials` and the "Resumen" metrics: all USD decimal strings. */
export const clientFinancialsSchema = z.object({
  clientId: idSchema,
  totalInvoicedUsd: usdTotalSchema,
  totalCollectedUsd: usdTotalSchema,
  /** Receivable balance. */
  receivableUsd: usdTotalSchema,
  /** Part of the receivable balance that is overdue (`VENCIDA`). */
  overdueUsd: usdTotalSchema,
  /** Credit balance: confirmed payments not yet allocated ("saldo a favor"). */
  creditBalanceUsd: usdTotalSchema,
  projectCount: z.number().int().nonnegative(),
});
export type ClientFinancialsDTO = z.infer<typeof clientFinancialsSchema>;

export const clientDetailSchema = z.object({
  id: idSchema,
  code: z.string(),
  kind: clientKindSchema,
  tradeName: z.string(),
  legalName: z.string(),
  taxId: z.string(),
  country: countryCodeSchema,
  address: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  website: z.string().nullable(),
  status: clientStatusSchema,
  /** Set the first time the client became `ACTIVO`. */
  activatedAt: timestampSchema.nullable(),
  tags: z.array(tagChipSchema),
  /** Highlighted contacts (primary first) for the "Resumen" tab; the full list is `listContacts`. */
  contacts: z.array(contactDetailSchema),
  financials: clientFinancialsSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  archivedAt: timestampSchema.nullable(),
});
export type ClientDetailDTO = z.infer<typeof clientDetailSchema>;

/** Output of `archiveClient`: the archived record plus how many contacts went with it. */
export const clientArchiveResultSchema = archivedRecordSchema.extend({
  archivedContacts: z.number().int().nonnegative(),
});
export type ClientArchiveResultDTO = z.infer<typeof clientArchiveResultSchema>;

/** Output of `archiveClients`: one result per archived client. */
export const clientsArchiveResultSchema = z.object({
  archived: z.array(clientArchiveResultSchema),
});
export type ClientsArchiveResultDTO = z.infer<typeof clientsArchiveResultSchema>;

/** `/clients` overview (PRD §8.2 "Overview"). */
export const clientsOverviewSchema = z.object({
  countByStatus: z.object({
    PROSPECTO: z.number().int().nonnegative(),
    ACTIVO: z.number().int().nonnegative(),
    INACTIVO: z.number().int().nonnegative(),
  }),
  /** Top 5 by collected revenue over the last 12 months. */
  topByRevenue: z.array(clientListRowSchema.extend({ collectedLast12MonthsUsd: usdTotalSchema })),
  withOverdueBalance: z.array(clientListRowSchema.extend({ overdueUsd: usdTotalSchema })),
  recentlyCreated: z.array(clientListRowSchema),
});
export type ClientsOverviewDTO = z.infer<typeof clientsOverviewSchema>;

export const getClientsOverviewInputSchema = z.object({}).strict();
export type GetClientsOverviewInput = z.infer<typeof getClientsOverviewInputSchema>;

// ───────────────────────────── Services (PRD §12 `clients`) ─────────────────────────────

/**
 * `clients` services. Every service is `fn(ctx, input) → Promise<DTO>` (C9, C11); `Ctx` is the service
 * context `{ db, user, now }`. Failures (CONFLICT on a duplicate tax id + country, INTEGRITY_LOCK…) are
 * reported to the action adapter, never returned as DTOs. `getClientsOverview` and `archiveClients`
 * are the screen counterparts that PRD §12 ("servicios principales") leaves implicit.
 */
export type ClientsService<Ctx = unknown> = {
  createClient: (ctx: Ctx, input: CreateClientInput) => Promise<ClientDetailDTO>;
  updateClient: (ctx: Ctx, input: UpdateClientInput) => Promise<ClientDetailDTO>;
  setClientStatus: (ctx: Ctx, input: SetClientStatusInput) => Promise<ClientDetailDTO>;
  archiveClient: (ctx: Ctx, input: ArchiveClientInput) => Promise<ClientArchiveResultDTO>;
  restoreClient: (ctx: Ctx, input: RestoreClientInput) => Promise<ClientDetailDTO>;
  listClients: (ctx: Ctx, input: ClientFilter) => Promise<Paginated<ClientListRowDTO>>;
  getClient: (ctx: Ctx, input: ClientIdInput) => Promise<ClientDetailDTO>;
  getClientFinancials: (ctx: Ctx, input: ClientIdInput) => Promise<ClientFinancialsDTO>;
  getClientsOverview: (ctx: Ctx, input: GetClientsOverviewInput) => Promise<ClientsOverviewDTO>;
  archiveClients: (ctx: Ctx, input: ArchiveClientsInput) => Promise<ClientsArchiveResultDTO>;
};
