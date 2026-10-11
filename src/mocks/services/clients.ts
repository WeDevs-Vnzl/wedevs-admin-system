// MOCK — clients service of Hito 1 (PRD §8.2, §12 `clients`; HU-03). Same function names and signatures as
// `ClientsService` (C9): `fn(ctx, input)`, framework-free (C11). Rules it carries, which H2-B3 reproduces:
//   - code `CLI-####` from the `CLI` sequence (HU-03 CA2); status defaults to `PROSPECTO`;
//   - (normalized tax id + country) is unique among non-archived clients: `CONFLICT` linking the existing
//     record, on create, update and restore (HU-03 CA3);
//   - archiving a client with active projects or open invoices needs `confirm` (`INTEGRITY_LOCK`
//     otherwise) and archives its contacts with it (C19); restoring revives exactly the contacts archived
//     by that cascade: those whose `archivedAt` equals the client's (contacts have no cascade marker);
//   - USD metrics are computed on read from the finance collections over stored snapshots, never typed in
//     (PD-4, C15, C16): `"0.00"` while those collections are empty;
//   - every mutation appends an activity entry (HU-03 CA4, C12 form).
// Replaced by `src/server/services/clients.service.ts` in Hito 2 (C9).
import { diffFields } from "@/lib/activity-diff";
import { addDays, toDateOnly, todayInCaracas } from "@/lib/dates";
import { compareMoney, isZeroMoney, sumMoney, toUsd } from "@/lib/money";
import { can } from "@/server/auth/permissions";
import { VALIDATION_MESSAGES, type EntityRef, type Paginated } from "@/lib/validators/common";
import {
  normalizeVeRif,
  type ArchiveClientInput,
  type ArchiveClientsInput,
  type ClientArchiveResultDTO,
  type ClientDetailDTO,
  type ClientFilter,
  type ClientFinancialsDTO,
  type ClientIdInput,
  type ClientListRowDTO,
  type ClientsArchiveResultDTO,
  type ClientsOverviewDTO,
  type ClientsService,
  type CreateClientInput,
  type GetClientsOverviewInput,
  type RestoreClientInput,
  type SetClientStatusInput,
  type UpdateClientInput,
} from "@/lib/validators/clients";
import type { MockServiceContext } from "../ctx";
import { ServiceError } from "../ctx";
import { nextMockCode, nextMockId } from "../ids";
import type { ClientRow, MockStore } from "../store";
import { deriveMockStore } from "../store";
import { logActivity, mockTx } from "./activity";
import { sortContacts, tagNames, toContactDTO } from "./contacts";
import { listRows, type ListSpec } from "./list";

const CLIENT_DIFF_FIELDS = [
  "kind",
  "tradeName",
  "legalName",
  "taxId",
  "country",
  "address",
  "phone",
  "email",
  "website",
  "tagIds",
];
const CLIENT_LONG_TEXT_FIELDS = ["address"];

/** Project statuses that still count as work in progress for the archive lock (PRD §7.7). */
const ACTIVE_PROJECT_STATUSES: readonly string[] = [
  "PROPUESTA",
  "EN_CURSO",
  "PAUSADO",
  "MANTENIMIENTO",
];
/** Invoice statuses with a balance still to collect (PRD §9.4, §8.1 "Cuentas por cobrar"). */
const OPEN_INVOICE_STATUSES: readonly string[] = ["EMITIDA", "PARCIAL", "VENCIDA"];

const OVERVIEW_TOP = 5;
const OVERVIEW_OVERDUE = 10;
const OVERVIEW_RECENT = 5;

// ───────────────────────────── Helpers ─────────────────────────────

/** Tax ids compare without case, spaces, dots or dashes (`j-30123456-7` equals `J301234567`). */
function taxIdKey(taxId: string): string {
  return taxId.replace(/[\s.-]/g, "").toUpperCase();
}

/** The form's tax id as stored: the canonical RIF for Venezuela, trimmed text elsewhere. */
function storedTaxId(taxId: string, country: string): string {
  return country === "VE" ? normalizeVeRif(taxId) : taxId.trim();
}

function toRef(row: ClientRow): EntityRef {
  return { id: row.id, code: row.code, label: row.tradeName, type: "CLIENT" };
}

/** The non-archived client that already holds (tax id + country), other than `exceptId`. */
function findTaxIdHolder(
  db: MockStore,
  taxId: string,
  country: string,
  exceptId?: string,
): ClientRow | undefined {
  const key = taxIdKey(taxId);
  return db.clients.find(
    (item) =>
      !item.archivedAt &&
      item.id !== exceptId &&
      item.country === country &&
      taxIdKey(item.taxId) === key,
  );
}

function assertTaxIdFree(
  db: MockStore,
  taxId: string,
  country: string,
  message: string,
  exceptId?: string,
): void {
  const holder = findTaxIdHolder(db, taxId, country, exceptId);
  if (holder) throw new ServiceError("CONFLICT", { message, entity: toRef(holder) });
}

function assertTagsExist(db: MockStore, tagIds: readonly string[]): void {
  if (tagIds.some((id) => !db.tags.some((tag) => tag.id === id))) {
    throw new ServiceError("VALIDATION", {
      fieldErrors: { tagIds: [VALIDATION_MESSAGES.invalidOption] },
    });
  }
}

function tagChips(db: MockStore, tagIds: readonly string[]) {
  return tagIds.flatMap((tagId) => {
    const tag = db.tags.find((item) => item.id === tagId);
    return tag ? [{ id: tag.id, name: tag.name, color: tag.color }] : [];
  });
}

/** Whether the caller may see archived rows (the trash grant, C19). */
function seesArchived(ctx: MockServiceContext): boolean {
  return can(ctx.user, "restore", "trash");
}

/** A client the caller may read: archived ones only for roles that may open the trash. */
function requireReadable(ctx: MockServiceContext, id: string): ClientRow {
  const row = ctx.db.clients.find((item) => item.id === id);
  if (!row || (row.archivedAt && !seesArchived(ctx))) throw new ServiceError("NOT_FOUND");
  return row;
}

function requireLive(db: MockStore, id: string): ClientRow {
  const row = db.clients.find((item) => item.id === id && !item.archivedAt);
  if (!row) throw new ServiceError("NOT_FOUND");
  return row;
}

// ───────────────────────────── Derived metrics (PD-4) ─────────────────────────────

interface ClientMetrics {
  totalInvoicedUsd: string;
  totalCollectedUsd: string;
  receivableUsd: string;
  overdueUsd: string;
  creditBalanceUsd: string;
  collectedLast12MonthsUsd: string;
  projectCount: number;
}

function liveProjectsOf(db: MockStore, clientId: string) {
  return db.projects.filter(
    (project) => !project.archivedAt && project.clients.some((link) => link.clientId === clientId),
  );
}

/**
 * Sums stored USD snapshots of the finance collections (C16); never converts with today's rate. Drafts and
 * voided invoices are not invoiced; only confirmed payments are collected.
 */
function computeMetrics(db: MockStore, clientId: string, today: string): ClientMetrics {
  const invoices = db.invoices.filter(
    (item) =>
      item.client.id === clientId &&
      !item.isDraft &&
      item.status !== "BORRADOR" &&
      item.status !== "ANULADA",
  );
  const open = invoices.filter((item) => OPEN_INVOICE_STATUSES.includes(item.status));
  const payments = db.payments.filter(
    (item) => item.client.id === clientId && item.status === "CONFIRMADO",
  );
  const since = addDays(today, -365);
  return {
    totalInvoicedUsd: sumMoney(invoices.map((item) => item.totals.totalUsd)),
    totalCollectedUsd: sumMoney(payments.map((item) => item.amountUsd)),
    receivableUsd: sumMoney(open.map((item) => item.totals.balanceUsd)),
    overdueUsd: sumMoney(
      open.filter((item) => item.status === "VENCIDA").map((item) => item.totals.balanceUsd),
    ),
    // "Saldo a favor": the unallocated part of confirmed payments, at each payment's own rate.
    creditBalanceUsd: sumMoney(payments.map((item) => toUsd(item.unallocated, item.usdRate))),
    collectedLast12MonthsUsd: sumMoney(
      payments.filter((item) => item.date >= since).map((item) => item.amountUsd),
    ),
    projectCount: liveProjectsOf(db, clientId).length,
  };
}

/** Latest activity entry on the client or on its contacts, projects, invoices and payments. */
function lastActivityOf(db: MockStore, clientId: string): string | null {
  const contactIds = new Set(
    db.contacts.filter((item) => item.clientId === clientId).map((item) => item.id),
  );
  const projectIds = new Set(
    db.projects
      .filter((item) => item.clients.some((link) => link.clientId === clientId))
      .map((item) => item.id),
  );
  const invoiceIds = new Set(
    db.invoices.filter((item) => item.client.id === clientId).map((item) => item.id),
  );
  const paymentIds = new Set(
    db.payments.filter((item) => item.client.id === clientId).map((item) => item.id),
  );
  let latest: string | null = null;
  for (const entry of db.activity) {
    const related =
      (entry.entityType === "CLIENT" && entry.entityId === clientId) ||
      (entry.entityType === "CONTACT" && contactIds.has(entry.entityId)) ||
      (entry.entityType === "PROJECT" && projectIds.has(entry.entityId)) ||
      (entry.entityType === "INVOICE" && invoiceIds.has(entry.entityId)) ||
      (entry.entityType === "PAYMENT" && paymentIds.has(entry.entityId));
    if (related && (latest === null || entry.createdAt > latest)) latest = entry.createdAt;
  }
  return latest;
}

// ───────────────────────────── DTO assembly ─────────────────────────────

function toListRow(db: MockStore, row: ClientRow, today: string): ClientListRowDTO {
  const metrics = computeMetrics(db, row.id, today);
  return {
    id: row.id,
    code: row.code,
    tradeName: row.tradeName,
    kind: row.kind,
    country: row.country,
    status: row.status,
    projectCount: metrics.projectCount,
    totalInvoicedUsd: metrics.totalInvoicedUsd,
    receivableUsd: metrics.receivableUsd,
    tags: tagChips(db, row.tagIds),
    lastActivityAt: lastActivityOf(db, row.id),
    archivedAt: row.archivedAt,
  };
}

function toFinancials(db: MockStore, clientId: string, today: string): ClientFinancialsDTO {
  const metrics = computeMetrics(db, clientId, today);
  return {
    clientId,
    totalInvoicedUsd: metrics.totalInvoicedUsd,
    totalCollectedUsd: metrics.totalCollectedUsd,
    receivableUsd: metrics.receivableUsd,
    overdueUsd: metrics.overdueUsd,
    creditBalanceUsd: metrics.creditBalanceUsd,
    projectCount: metrics.projectCount,
  };
}

function toDetail(ctx: MockServiceContext, row: ClientRow): ClientDetailDTO {
  const { db } = ctx;
  const contacts = sortContacts(
    db.contacts.filter((item) => item.clientId === row.id && !item.archivedAt),
  ).map((contact) => toContactDTO(db, contact));
  return {
    id: row.id,
    code: row.code,
    kind: row.kind,
    tradeName: row.tradeName,
    legalName: row.legalName,
    taxId: row.taxId,
    country: row.country,
    address: row.address,
    phone: row.phone,
    email: row.email,
    website: row.website,
    status: row.status,
    activatedAt: row.activatedAt,
    tags: tagChips(db, row.tagIds),
    contacts,
    financials: toFinancials(db, row.id, todayInCaracas(ctx.now)),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
  };
}

// ───────────────────────────── Mutations ─────────────────────────────

export async function createClient(
  ctx: MockServiceContext,
  input: CreateClientInput,
): Promise<ClientDetailDTO> {
  const { db } = ctx;
  assertTaxIdFree(db, input.taxId, input.country, "clients.errors.duplicateTaxId");
  assertTagsExist(db, input.tagIds);

  const now = ctx.now.toISOString();
  const row: ClientRow = {
    id: nextMockId(db.idCounters, "cli", (id) => db.clients.some((item) => item.id === id)),
    code: nextMockCode(db.sequences, "CLI"),
    kind: input.kind,
    tradeName: input.tradeName,
    // A person's legal name is the trade name when the form leaves it empty.
    legalName: input.legalName ?? input.tradeName,
    taxId: storedTaxId(input.taxId, input.country),
    country: input.country,
    address: input.address,
    phone: input.phone,
    email: input.email ?? null,
    website: input.website ?? null,
    status: input.status,
    activatedAt: input.status === "ACTIVO" ? now : null,
    tagIds: [...input.tagIds],
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    deletedById: null,
  };
  db.clients.push(row);
  await logActivity(mockTx(ctx), {
    actorType: "USER",
    actorId: ctx.user.id,
    action: "CREATE",
    entityType: "CLIENT",
    entityId: row.id,
    entityLabel: row.tradeName,
    metadata: { code: row.code },
  });
  deriveMockStore(db);
  return toDetail(ctx, row);
}

export async function updateClient(
  ctx: MockServiceContext,
  input: UpdateClientInput,
): Promise<ClientDetailDTO> {
  const { db } = ctx;
  const row = requireLive(db, input.id);
  assertTaxIdFree(db, input.taxId, input.country, "clients.errors.duplicateTaxId", row.id);
  assertTagsExist(db, input.tagIds);

  const before = { ...row, tagIds: tagNames(db, row.tagIds) };
  row.kind = input.kind;
  row.tradeName = input.tradeName;
  row.legalName = input.legalName ?? input.tradeName;
  row.taxId = storedTaxId(input.taxId, input.country);
  row.country = input.country;
  row.address = input.address;
  row.phone = input.phone;
  row.email = input.email ?? null;
  row.website = input.website ?? null;
  row.tagIds = [...input.tagIds];
  const changes = diffFields(
    before,
    { ...row, tagIds: tagNames(db, row.tagIds) },
    {
      fields: CLIENT_DIFF_FIELDS,
      longText: CLIENT_LONG_TEXT_FIELDS,
    },
  );
  if (changes) {
    row.updatedAt = ctx.now.toISOString();
    await logActivity(mockTx(ctx), {
      actorType: "USER",
      actorId: ctx.user.id,
      action: "UPDATE",
      entityType: "CLIENT",
      entityId: row.id,
      entityLabel: row.tradeName,
      changes,
    });
  }
  deriveMockStore(db);
  return toDetail(ctx, row);
}

/** Manual status change (PRD §8.2). `activatedAt` is set the first time the client becomes `ACTIVO`. */
export async function setClientStatus(
  ctx: MockServiceContext,
  input: SetClientStatusInput,
): Promise<ClientDetailDTO> {
  const { db } = ctx;
  const row = requireLive(db, input.id);
  if (row.status !== input.status) {
    const previous = row.status;
    row.status = input.status;
    row.updatedAt = ctx.now.toISOString();
    if (input.status === "ACTIVO" && row.activatedAt === null) row.activatedAt = row.updatedAt;
    await logActivity(mockTx(ctx), {
      actorType: "USER",
      actorId: ctx.user.id,
      action: "STATUS_CHANGE",
      entityType: "CLIENT",
      entityId: row.id,
      entityLabel: row.tradeName,
      changes: { status: [previous, input.status] },
    });
  }
  deriveMockStore(db);
  return toDetail(ctx, row);
}

/** Whether archiving needs the user's confirmation: active projects or open invoices (C19, PRD §7.7). */
function hasArchiveDependents(db: MockStore, clientId: string): boolean {
  const activeProjects = liveProjectsOf(db, clientId).some((project) =>
    ACTIVE_PROJECT_STATUSES.includes(project.status),
  );
  const openInvoices = db.invoices.some(
    (invoice) =>
      invoice.client.id === clientId &&
      !invoice.isDraft &&
      OPEN_INVOICE_STATUSES.includes(invoice.status),
  );
  return activeProjects || openInvoices;
}

function assertArchivable(db: MockStore, row: ClientRow, confirm: boolean): void {
  if (!confirm && hasArchiveDependents(db, row.id)) {
    throw new ServiceError("INTEGRITY_LOCK", {
      message: "clients.errors.archiveNeedsConfirm",
      entity: toRef(row),
    });
  }
}

/** Archives `row` and, in the same call, its live contacts with the same `archivedAt` (C19). */
async function archiveCascade(
  ctx: MockServiceContext,
  row: ClientRow,
): Promise<ClientArchiveResultDTO> {
  const { db } = ctx;
  const archivedAt = ctx.now.toISOString();
  const contacts = db.contacts.filter((item) => item.clientId === row.id && !item.archivedAt);
  row.archivedAt = archivedAt;
  row.deletedById = ctx.user.id;
  row.updatedAt = archivedAt;
  await logActivity(mockTx(ctx), {
    actorType: "USER",
    actorId: ctx.user.id,
    action: "DELETE",
    entityType: "CLIENT",
    entityId: row.id,
    entityLabel: row.tradeName,
    metadata: { archivedContacts: contacts.length },
  });
  for (const contact of contacts) {
    const wasPrimary = contact.isPrimary;
    contact.archivedAt = archivedAt;
    contact.updatedAt = archivedAt;
    await logActivity(mockTx(ctx), {
      actorType: "USER",
      actorId: ctx.user.id,
      action: "DELETE",
      entityType: "CONTACT",
      entityId: contact.id,
      entityLabel: contact.fullName,
      metadata: { clientId: row.id, cascade: true, wasPrimary },
    });
  }
  return { id: row.id, archivedAt, archivedContacts: contacts.length };
}

export async function archiveClient(
  ctx: MockServiceContext,
  input: ArchiveClientInput,
): Promise<ClientArchiveResultDTO> {
  const { db } = ctx;
  const row = requireLive(db, input.id);
  assertArchivable(db, row, input.confirm);
  const result = await archiveCascade(ctx, row);
  deriveMockStore(db);
  return result;
}

/** Bulk archive: all or nothing, so one locked client leaves the whole selection untouched. */
export async function archiveClients(
  ctx: MockServiceContext,
  input: ArchiveClientsInput,
): Promise<ClientsArchiveResultDTO> {
  const { db } = ctx;
  const rows = [...new Set(input.ids)].map((id) => requireLive(db, id));
  for (const row of rows) assertArchivable(db, row, input.confirm);
  const archived: ClientArchiveResultDTO[] = [];
  for (const row of rows) archived.push(await archiveCascade(ctx, row));
  deriveMockStore(db);
  return { archived };
}

/**
 * Takes the client out of the archive. `CONFLICT` (linking the holder) when another live client now has the
 * same tax id + country. Revives the contacts archived by the same cascade: those whose `archivedAt` equals
 * the client's; contacts archived on their own earlier stay archived.
 */
export async function restoreClient(
  ctx: MockServiceContext,
  input: RestoreClientInput,
): Promise<ClientDetailDTO> {
  const { db } = ctx;
  const row = db.clients.find((item) => item.id === input.id);
  if (!row || !row.archivedAt) throw new ServiceError("NOT_FOUND");
  assertTaxIdFree(db, row.taxId, row.country, "clients.errors.restoreTaxIdConflict", row.id);

  const cascadeAt = row.archivedAt;
  row.archivedAt = null;
  row.deletedById = null;
  row.updatedAt = ctx.now.toISOString();
  const contacts = db.contacts.filter(
    (item) => item.clientId === row.id && item.archivedAt === cascadeAt,
  );
  await logActivity(mockTx(ctx), {
    actorType: "USER",
    actorId: ctx.user.id,
    action: "RESTORE",
    entityType: "CLIENT",
    entityId: row.id,
    entityLabel: row.tradeName,
    metadata: { restoredContacts: contacts.length },
  });
  for (const contact of contacts) {
    contact.archivedAt = null;
    contact.updatedAt = row.updatedAt;
    await logActivity(mockTx(ctx), {
      actorType: "USER",
      actorId: ctx.user.id,
      action: "RESTORE",
      entityType: "CONTACT",
      entityId: contact.id,
      entityLabel: contact.fullName,
      metadata: { clientId: row.id, cascade: true },
    });
  }
  deriveMockStore(db);
  return toDetail(ctx, row);
}

// ───────────────────────────── Reads ─────────────────────────────

/** Search and sort over list rows; the fields the DTO does not carry are read from the stored row. */
function clientSpec(stored: ReadonlyMap<string, ClientRow>): ListSpec<ClientListRowDTO> {
  return {
    searchText: (row) => {
      const source = stored.get(row.id);
      return [row.tradeName, source?.legalName, row.code, source?.taxId, source?.email];
    },
    sorters: {
      code: (row) => row.code,
      tradeName: (row) => row.tradeName,
      kind: (row) => row.kind,
      country: (row) => row.country,
      status: (row) => row.status,
      projectCount: (row) => row.projectCount,
      totalInvoicedUsd: (row) => row.totalInvoicedUsd,
      receivableUsd: (row) => row.receivableUsd,
      lastActivityAt: (row) => row.lastActivityAt,
      createdAt: (row) => stored.get(row.id)?.createdAt ?? null,
    },
    defaultSort: "code:asc",
  };
}

/**
 * Every filter of `clientFilterSchema`. Archived clients appear only with `includeArchived` and only for
 * roles that may open the trash: for anyone else the flag is ignored (C19).
 */
export async function listClients(
  ctx: MockServiceContext,
  input: ClientFilter,
): Promise<Paginated<ClientListRowDTO>> {
  const { db } = ctx;
  const today = todayInCaracas(ctx.now);
  const showArchived = input.includeArchived && seesArchived(ctx);
  const matching = db.clients.filter((row) => {
    if (row.archivedAt && !showArchived) return false;
    if (input.status && !input.status.includes(row.status)) return false;
    if (input.kind && !input.kind.includes(row.kind)) return false;
    if (input.country && !input.country.includes(row.country)) return false;
    if (input.tagId && !input.tagId.some((tagId) => row.tagIds.includes(tagId))) return false;
    const created = toDateOnly(new Date(row.createdAt));
    if (input.createdFrom && created < input.createdFrom) return false;
    if (input.createdTo && created > input.createdTo) return false;
    if (input.hasOverdue !== undefined) {
      const overdue = !isZeroMoney(computeMetrics(db, row.id, today).overdueUsd);
      if (overdue !== input.hasOverdue) return false;
    }
    return true;
  });
  const stored = new Map(matching.map((row) => [row.id, row] as const));
  const rows = matching.map((row) => toListRow(db, row, today));
  return listRows(rows, input, clientSpec(stored));
}

/** The client with its contacts (primary first). Archived ones are visible only to the trash roles. */
export async function getClient(
  ctx: MockServiceContext,
  input: ClientIdInput,
): Promise<ClientDetailDTO> {
  return toDetail(ctx, requireReadable(ctx, input.id));
}

export async function getClientFinancials(
  ctx: MockServiceContext,
  input: ClientIdInput,
): Promise<ClientFinancialsDTO> {
  const row = requireReadable(ctx, input.id);
  return toFinancials(ctx.db, row.id, todayInCaracas(ctx.now));
}

/** `/clients` overview (PRD §8.2): counts by status and three short lists, all over live clients. */
export async function getClientsOverview(
  ctx: MockServiceContext,
  input: GetClientsOverviewInput,
): Promise<ClientsOverviewDTO> {
  void input; // the overview takes no parameters yet; the signature stays the contract's
  const { db } = ctx;
  const today = todayInCaracas(ctx.now);
  const live = db.clients.filter((row) => !row.archivedAt);
  const countByStatus = { PROSPECTO: 0, ACTIVO: 0, INACTIVO: 0 };
  for (const row of live) countByStatus[row.status] += 1;

  const withMetrics = live.map((row) => ({
    row,
    list: toListRow(db, row, today),
    metrics: computeMetrics(db, row.id, today),
  }));
  const byMoneyDesc = (a: string, b: string) => compareMoney(b, a);

  return {
    countByStatus,
    topByRevenue: withMetrics
      .filter((item) => !isZeroMoney(item.metrics.collectedLast12MonthsUsd))
      .sort((a, b) =>
        byMoneyDesc(a.metrics.collectedLast12MonthsUsd, b.metrics.collectedLast12MonthsUsd),
      )
      .slice(0, OVERVIEW_TOP)
      .map((item) => ({
        ...item.list,
        collectedLast12MonthsUsd: item.metrics.collectedLast12MonthsUsd,
      })),
    withOverdueBalance: withMetrics
      .filter((item) => !isZeroMoney(item.metrics.overdueUsd))
      .sort((a, b) => byMoneyDesc(a.metrics.overdueUsd, b.metrics.overdueUsd))
      .slice(0, OVERVIEW_OVERDUE)
      .map((item) => ({ ...item.list, overdueUsd: item.metrics.overdueUsd })),
    recentlyCreated: [...withMetrics]
      .sort((a, b) => b.row.createdAt.localeCompare(a.row.createdAt))
      .slice(0, OVERVIEW_RECENT)
      .map((item) => item.list),
  };
}

/** Typeahead for pickers: live clients matching `q` as `EntityRef`s (at most `limit`, default 20). */
export async function searchClients(
  ctx: MockServiceContext,
  input: { q?: string | undefined; limit?: number },
): Promise<EntityRef[]> {
  const rows = ctx.db.clients.filter((row) => !row.archivedAt);
  const page = listRows(
    rows,
    { page: 1, pageSize: 100, q: input.q },
    {
      searchText: (row) => [row.tradeName, row.legalName, row.code, row.taxId],
      sorters: { tradeName: (row) => row.tradeName },
      defaultSort: "tradeName:asc",
    },
  );
  return page.items.slice(0, input.limit ?? 20).map(toRef);
}

// Compile-time check that the exported functions match the contract (C9).
const _contract = {
  createClient,
  updateClient,
  setClientStatus,
  archiveClient,
  restoreClient,
  listClients,
  getClient,
  getClientFinancials,
  getClientsOverview,
  archiveClients,
} satisfies ClientsService<MockServiceContext>;
void _contract;
