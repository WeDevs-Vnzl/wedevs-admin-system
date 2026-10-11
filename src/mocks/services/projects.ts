// MOCK — projects service of Hito 1 (PRD §8.3, §12 `projects`; HU-05…HU-08). `fn(ctx, input)` with the names
// of `ProjectsService` (C9), framework-free (C11): the clock is `ctx.now`. Rows are normalized (PD-3); the
// DTOs are assembled here, so a renamed client, technology or tag never goes stale. The financial headline
// is computed on read from the finance collections (PD-4), `"0.00"` while they are empty. Every mutation
// appends its activity entries through `logActivity` (C12 shape). `getProjectFinancials` belongs to H1-B3
// and is not exported yet. Replaced by `src/server/services/projects.service.ts` in Hito 2 (C9).
import { diffFields } from "@/lib/activity-diff";
import { todayInCaracas, type DateOnly } from "@/lib/dates";
import { compareMoney, subMoney, sumMoney, toUsd } from "@/lib/money";
import { can } from "@/server/auth/permissions";
import { VALIDATION_MESSAGES, type FieldErrors, type Paginated } from "@/lib/validators/common";
import {
  PROJECT_LINK_GROUP_VALUES,
  PROJECT_STATUS_VALUES,
  type ProjectLinkGroup,
  type ProjectStatus,
} from "@/lib/validators/enums";
import {
  canTransitionProject,
  type ArchiveProjectInput,
  type ArchiveProjectsInput,
  type CreateProjectInput,
  type GetProjectsOverviewInput,
  type ProjectClientInput,
  type ProjectDetailDTO,
  type ProjectFilter,
  type ProjectFinancialHeadlineDTO,
  type ProjectIdInput,
  type ProjectLinkDTO,
  type ProjectLinkInput,
  type ProjectListRowDTO,
  type ProjectsOverviewDTO,
  type ProjectStatusChangeResultDTO,
  type ProjectStatusHint,
  type RemoveProjectLinkInput,
  type ReorderProjectLinksInput,
  type SetProjectClientsInput,
  type SetProjectStatusInput,
  type SetProjectTechnologiesInput,
  type UpdateProjectInput,
  type UpsertProjectLinksInput,
} from "@/lib/validators/projects";
import { httpUrlSchema, type TagChipDTO } from "@/lib/validators/tags";
import type { TechnologyChipDTO } from "@/lib/validators/technologies";
import type { ArchivedRecordDTO } from "@/lib/validators/trash";
import type { MockServiceContext } from "../ctx";
import { ServiceError } from "../ctx";
import { resolveEntityRef } from "../entity-refs";
import { nextMockCode, nextMockId } from "../ids";
import type { MockStore, ProjectRow } from "../store";
import { deriveMockStore } from "../store";
import { logActivity, mockTx, type MockTx } from "./activity";
import { listRows, type ListSpec } from "./list";

const ZERO = "0.00";
const OVERVIEW_LIST_SIZE = 5;
const TOP_TECHNOLOGIES = 8;

/** Fields of a project the `UPDATE` diff compares (ids are sorted first, the diff is ordered JSON). */
const UPDATE_DIFF_FIELDS = [
  "name",
  "summary",
  "description",
  "startDate",
  "targetEndDate",
  "endDate",
  "technologyIds",
  "tagIds",
] as const;

// ───────────────────────────── Lookups ─────────────────────────────

function findProject(db: MockStore, id: string): ProjectRow {
  const row = db.projects.find((item) => item.id === id);
  if (!row) throw new ServiceError("NOT_FOUND");
  return row;
}

/** A project that can still be edited: archived rows answer `NOT_FOUND` to mutations. */
function findLiveProject(db: MockStore, id: string): ProjectRow {
  const row = findProject(db, id);
  if (row.archivedAt) throw new ServiceError("NOT_FOUND");
  return row;
}

function invalid(field: string, key: string): ServiceError {
  return new ServiceError("VALIDATION", { fieldErrors: { [field]: [key] } });
}

const sortedIds = (ids: readonly string[]): string[] => [...ids].sort();

// ───────────────────────────── Financial headline (PD-4) ─────────────────────────────

/** Latest USD rate of `currency` on or before `today`; `null` when there is none. */
function latestRate(db: MockStore, currency: string, today: DateOnly): string | null {
  let best: { date: string; usdRate: string } | null = null;
  for (const rate of db.exchangeRates) {
    if (rate.currency !== currency || rate.date > today) continue;
    if (!best || rate.date > best.date) best = rate;
  }
  return best?.usdRate ?? null;
}

/**
 * USD headline of a project from the finance collections (empty until H1-B3, so `"0.00"`): contracted =
 * plan contract amounts (non-USD at the latest rate), invoiced = the project's lines on issued invoices at
 * the invoice rate, collected = confirmed payment allocations on those invoices, to invoice = the rest of
 * the contract. H1-B3 may replace this with `src/lib/finance`.
 */
function projectHeadline(
  db: MockStore,
  projectId: string,
  today: DateOnly,
): ProjectFinancialHeadlineDTO {
  const contracted: string[] = [];
  for (const plan of db.billingPlans) {
    if (plan.projectId !== projectId || plan.contractAmount === null) continue;
    if (plan.currency === "USD") {
      contracted.push(plan.contractAmount);
      continue;
    }
    const rate = latestRate(db, plan.currency, today);
    if (rate) contracted.push(toUsd(plan.contractAmount, rate));
  }

  const invoiced: string[] = [];
  const invoiceIds = new Set<string>();
  for (const invoice of db.invoices) {
    if (invoice.isDraft || invoice.status === "BORRADOR" || invoice.status === "ANULADA") continue;
    for (const line of invoice.lines) {
      if (line.project?.id !== projectId) continue;
      invoiced.push(toUsd(line.netAmount, invoice.usdRate));
      invoiceIds.add(invoice.id);
    }
  }

  const confirmedPayments = new Set(
    db.payments.filter((payment) => payment.status === "CONFIRMADO").map((payment) => payment.id),
  );
  const collected = db.paymentAllocations
    .filter(
      (allocation) =>
        invoiceIds.has(allocation.invoice.id) && confirmedPayments.has(allocation.paymentId),
    )
    .map((allocation) => allocation.amountUsd);

  const contractedValueUsd = contracted.length > 0 ? sumMoney(contracted) : ZERO;
  const invoicedUsd = invoiced.length > 0 ? sumMoney(invoiced) : ZERO;
  const remaining = subMoney(contractedValueUsd, invoicedUsd);
  return {
    contractedValueUsd,
    invoicedUsd,
    collectedUsd: collected.length > 0 ? sumMoney(collected) : ZERO,
    toInvoiceUsd: compareMoney(remaining, ZERO) > 0 ? remaining : ZERO,
  };
}

// ───────────────────────────── DTO assembly ─────────────────────────────

function technologyChip(db: MockStore, id: string): TechnologyChipDTO | null {
  const tech = db.technologies.find((item) => item.id === id);
  if (!tech) return null;
  const { id: techId, name, nameEn, slug, category, iconSlug, color } = tech;
  return { id: techId, name, nameEn, slug, category, iconSlug, color };
}

function tagChip(db: MockStore, id: string): TagChipDTO | null {
  const tag = db.tags.find((item) => item.id === id);
  return tag ? { id: tag.id, name: tag.name, color: tag.color } : null;
}

function compact<T>(items: readonly (T | null)[]): T[] {
  return items.filter((item): item is T => item !== null);
}

function sortLinks(links: readonly ProjectLinkDTO[]): ProjectLinkDTO[] {
  return [...links]
    .map((link) => ({ ...link }))
    .sort(
      (a, b) =>
        PROJECT_LINK_GROUP_VALUES.indexOf(a.group) - PROJECT_LINK_GROUP_VALUES.indexOf(b.group) ||
        a.order - b.order,
    );
}

function hasBillingPlan(db: MockStore, projectId: string): boolean {
  return db.billingPlans.some((plan) => plan.projectId === projectId);
}

function toListRow(ctx: MockServiceContext, row: ProjectRow): ProjectListRowDTO {
  const { db, now } = ctx;
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    clients: compact(
      row.clients.map((link) => {
        const client = resolveEntityRef(db, "CLIENT", link.clientId);
        return client ? { client, role: link.role } : null;
      }),
    ),
    status: row.status,
    startDate: row.startDate,
    targetEndDate: row.targetEndDate,
    stack: compact(row.technologyIds.map((id) => technologyChip(db, id))),
    tags: compact(row.tagIds.map((id) => tagChip(db, id))),
    archivedAt: row.archivedAt,
    ...projectHeadline(db, row.id, todayInCaracas(now)),
  };
}

function toDetail(ctx: MockServiceContext, row: ProjectRow): ProjectDetailDTO {
  const list = toListRow(ctx, row);
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    summary: row.summary,
    description: row.description,
    status: row.status,
    startDate: row.startDate,
    targetEndDate: row.targetEndDate,
    endDate: row.endDate,
    clients: list.clients,
    stack: list.stack,
    links: sortLinks(row.links),
    tags: list.tags,
    contractedValueUsd: list.contractedValueUsd,
    invoicedUsd: list.invoicedUsd,
    collectedUsd: list.collectedUsd,
    toInvoiceUsd: list.toInvoiceUsd,
    hasBillingPlan: hasBillingPlan(ctx.db, row.id),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
  };
}

// ───────────────────────────── Validation of references ─────────────────────────────

/** Clients must exist and not be archived; the ones already linked keep their link. */
function assertClients(
  db: MockStore,
  clients: readonly ProjectClientInput[],
  alreadyLinked: readonly string[] = [],
): void {
  if (clients.length === 0) throw invalid("clients", VALIDATION_MESSAGES.required);
  const ids = clients.map((client) => client.clientId);
  if (new Set(ids).size !== ids.length) {
    throw invalid("clients", VALIDATION_MESSAGES.invalidOption);
  }
  for (const id of ids) {
    if (alreadyLinked.includes(id)) continue;
    const client = db.clients.find((item) => item.id === id);
    if (!client || client.archivedAt) throw invalid("clients", "projects.errors.clientNotFound");
  }
}

/**
 * The stack takes catalog ids only (HU-06 CA1): unknown → `VALIDATION` on the field, and so is an inactive
 * technology unless the project already carried it (editing a project never forces its stack to change).
 */
function assertTechnologies(
  db: MockStore,
  ids: readonly string[],
  alreadyOnProject: readonly string[] = [],
): void {
  for (const id of ids) {
    const tech = db.technologies.find((item) => item.id === id);
    if (!tech) throw invalid("technologyIds", "projects.errors.technologyUnknown");
    if (!tech.active && !alreadyOnProject.includes(id)) {
      throw invalid("technologyIds", "projects.errors.technologyInactive");
    }
  }
}

function assertTags(db: MockStore, ids: readonly string[]): void {
  for (const id of ids) {
    if (!db.tags.some((tag) => tag.id === id)) {
      throw invalid("tagIds", "projects.errors.tagUnknown");
    }
  }
}

/** `http(s)` URLs only (HU-07 CA3), reported on `links.<index>.url`. */
function assertLinkUrls(links: readonly ProjectLinkInput[]): void {
  const fieldErrors: FieldErrors = {};
  links.forEach((link, index) => {
    if (!httpUrlSchema.safeParse(link.url).success) {
      fieldErrors[`links.${index}.url`] = [VALIDATION_MESSAGES.invalidFormat];
    }
  });
  if (Object.keys(fieldErrors).length > 0) throw new ServiceError("VALIDATION", { fieldErrors });
}

/** Re-numbers the links of every group to `0..n-1`, keeping the current relative order. */
function renumberLinks(links: ProjectLinkDTO[]): ProjectLinkDTO[] {
  const next: ProjectLinkDTO[] = [];
  for (const group of PROJECT_LINK_GROUP_VALUES) {
    sortLinks(links.filter((link) => link.group === group)).forEach((link, order) => {
      next.push({ ...link, order });
    });
  }
  return next;
}

// ───────────────────────────── Activity ─────────────────────────────

async function logProject(
  tx: MockTx,
  actorId: string,
  action: "CREATE" | "UPDATE" | "DELETE" | "STATUS_CHANGE" | "LINK" | "UNLINK",
  row: ProjectRow,
  extra: {
    changes?: Parameters<typeof logActivity>[1]["changes"];
    metadata?: Parameters<typeof logActivity>[1]["metadata"];
  } = {},
): Promise<void> {
  await logActivity(tx, {
    actorType: "USER",
    actorId,
    action,
    entityType: "PROJECT",
    entityId: row.id,
    entityLabel: row.name,
    ...extra,
  });
}

/** Client links that appeared, disappeared or changed role between `before` and `after`. */
async function logClientLinks(
  ctx: MockServiceContext,
  row: ProjectRow,
  before: readonly { clientId: string; role: string | null }[],
  after: readonly { clientId: string; role: string | null }[],
): Promise<boolean> {
  const tx = mockTx(ctx);
  const meta = (clientId: string, role: string | null) => ({
    linkedType: "CLIENT",
    linkedId: clientId,
    linkedLabel: resolveEntityRef(ctx.db, "CLIENT", clientId)?.label ?? clientId,
    role,
  });
  let changed = false;
  for (const link of after) {
    const previous = before.find((item) => item.clientId === link.clientId);
    if (!previous) {
      await logProject(tx, ctx.user.id, "LINK", row, { metadata: meta(link.clientId, link.role) });
      changed = true;
    } else if (previous.role !== link.role) {
      await logProject(tx, ctx.user.id, "UPDATE", row, {
        changes: { clientRole: [previous.role, link.role] },
        metadata: meta(link.clientId, link.role),
      });
      changed = true;
    }
  }
  for (const link of before) {
    if (after.some((item) => item.clientId === link.clientId)) continue;
    await logProject(tx, ctx.user.id, "UNLINK", row, { metadata: meta(link.clientId, link.role) });
    changed = true;
  }
  return changed;
}

function touch(row: ProjectRow, ctx: MockServiceContext): void {
  row.updatedAt = ctx.now.toISOString();
}

// ───────────────────────────── Mutations ─────────────────────────────

export async function createProject(
  ctx: MockServiceContext,
  input: CreateProjectInput,
): Promise<ProjectDetailDTO> {
  const { db } = ctx;
  assertClients(db, input.clients);
  assertTechnologies(db, input.technologyIds);
  assertTags(db, input.tagIds);
  assertLinkUrls(input.links);

  const now = ctx.now.toISOString();
  const code = nextMockCode(db.sequences, "PRY");
  const id = nextMockId(db.idCounters, "pry", (value) => db.projects.some((p) => p.id === value));
  const linkIds = new Set<string>();
  const links = renumberLinks(
    input.links
      .map((link, position) => ({ link, position }))
      .sort((a, b) => a.link.order - b.link.order || a.position - b.position)
      .map(({ link }) => ({
        id: nextMockId(db.idCounters, "plk", (value) => {
          const taken =
            linkIds.has(value) || db.projects.some((p) => p.links.some((l) => l.id === value));
          return taken;
        }),
        group: link.group,
        label: link.label,
        url: link.url,
        order: link.order,
      })),
  );
  for (const link of links) linkIds.add(link.id);

  const row: ProjectRow = {
    id,
    code,
    name: input.name,
    summary: input.summary,
    description: input.description ?? null,
    status: input.status,
    startDate: input.startDate ?? null,
    targetEndDate: input.targetEndDate ?? null,
    endDate: input.endDate ?? null,
    clients: input.clients.map((client) => ({
      clientId: client.clientId,
      role: client.role ?? null,
    })),
    technologyIds: [...input.technologyIds],
    tagIds: [...input.tagIds],
    links,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    deletedById: null,
  };
  db.projects.push(row);

  await logProject(mockTx(ctx), ctx.user.id, "CREATE", row, {
    metadata: { code: row.code, status: row.status },
  });
  await logClientLinks(ctx, row, [], row.clients);
  return toDetail(ctx, row);
}

/** The editable fields of a row as the `UPDATE` diff sees them (id lists sorted). */
function diffView(row: ProjectRow): Record<string, unknown> {
  return {
    ...row,
    description: row.description ? JSON.stringify(row.description) : null,
    technologyIds: sortedIds(row.technologyIds),
    tagIds: sortedIds(row.tagIds),
  };
}

export async function updateProject(
  ctx: MockServiceContext,
  input: UpdateProjectInput,
): Promise<ProjectDetailDTO> {
  const { db } = ctx;
  const row = findLiveProject(db, input.id);
  assertClients(
    db,
    input.clients,
    row.clients.map((client) => client.clientId),
  );
  assertTechnologies(db, input.technologyIds, row.technologyIds);
  assertTags(db, input.tagIds);
  // A project already in progress or delivered keeps the date that status was entered with.
  if (row.status === "EN_CURSO" && !input.startDate) {
    throw invalid("startDate", VALIDATION_MESSAGES.required);
  }
  if (row.status === "ENTREGADO" && !input.endDate) {
    throw invalid("endDate", VALIDATION_MESSAGES.required);
  }

  const before = diffView(row);
  const previousClients = row.clients.map((client) => ({ ...client }));
  row.name = input.name;
  row.summary = input.summary;
  row.description = input.description ?? null;
  row.startDate = input.startDate ?? null;
  row.targetEndDate = input.targetEndDate ?? null;
  row.endDate = input.endDate ?? null;
  row.technologyIds = [...input.technologyIds];
  row.tagIds = [...input.tagIds];
  row.clients = input.clients.map((client) => ({
    clientId: client.clientId,
    role: client.role ?? null,
  }));
  touch(row, ctx);

  const changes = diffFields(before, diffView(row), {
    fields: UPDATE_DIFF_FIELDS,
    longText: ["description"],
  });
  if (changes) await logProject(mockTx(ctx), ctx.user.id, "UPDATE", row, { changes });
  await logClientLinks(ctx, row, previousClients, row.clients);
  return toDetail(ctx, row);
}

export async function setProjectClients(
  ctx: MockServiceContext,
  input: SetProjectClientsInput,
): Promise<ProjectDetailDTO> {
  const row = findLiveProject(ctx.db, input.projectId);
  assertClients(
    ctx.db,
    input.clients,
    row.clients.map((client) => client.clientId),
  );
  const previous = row.clients.map((client) => ({ ...client }));
  row.clients = input.clients.map((client) => ({
    clientId: client.clientId,
    role: client.role ?? null,
  }));
  if (await logClientLinks(ctx, row, previous, row.clients)) touch(row, ctx);
  return toDetail(ctx, row);
}

export async function setProjectTechnologies(
  ctx: MockServiceContext,
  input: SetProjectTechnologiesInput,
): Promise<ProjectDetailDTO> {
  const row = findLiveProject(ctx.db, input.projectId);
  assertTechnologies(ctx.db, input.technologyIds, row.technologyIds);
  const before = diffView(row);
  row.technologyIds = [...input.technologyIds];
  const changes = diffFields(before, diffView(row), { fields: ["technologyIds"] });
  if (changes) {
    touch(row, ctx);
    await logProject(mockTx(ctx), ctx.user.id, "UPDATE", row, { changes });
  }
  return toDetail(ctx, row);
}

/**
 * Creates the links without id and updates the ones with id; removes none. A new link goes to the end of
 * its group; an updated one moves to its `order` (a different group puts it last there). Every group is
 * then re-numbered `0..n-1`.
 */
export async function upsertProjectLinks(
  ctx: MockServiceContext,
  input: UpsertProjectLinksInput,
): Promise<ProjectLinkDTO[]> {
  const { db } = ctx;
  const row = findLiveProject(db, input.projectId);
  assertLinkUrls(input.links);

  const links = row.links.map((link) => ({ ...link }));
  const lastOrder = (group: ProjectLinkGroup) =>
    links
      .filter((link) => link.group === group)
      .reduce((max, link) => Math.max(max, link.order), -1);

  input.links.forEach((entry, index) => {
    if (entry.id === undefined) {
      links.push({
        id: nextMockId(
          db.idCounters,
          "plk",
          (value) =>
            links.some((link) => link.id === value) ||
            db.projects.some((project) => project.links.some((link) => link.id === value)),
        ),
        group: entry.group,
        label: entry.label,
        url: entry.url,
        order: lastOrder(entry.group) + 1,
      });
      return;
    }
    const current = links.find((link) => link.id === entry.id);
    if (!current) {
      throw new ServiceError("NOT_FOUND", { fieldErrors: { [`links.${index}.id`]: [entry.id] } });
    }
    const moved = current.group !== entry.group;
    current.label = entry.label;
    current.url = entry.url;
    current.order = moved ? lastOrder(entry.group) + 1 : entry.order;
    current.group = entry.group;
  });

  row.links = renumberLinks(links);
  touch(row, ctx);
  await logProject(mockTx(ctx), ctx.user.id, "UPDATE", row, {
    changes: { links: "changed" },
    metadata: { linkCount: row.links.length },
  });
  return sortLinks(row.links);
}

export async function reorderProjectLinks(
  ctx: MockServiceContext,
  input: ReorderProjectLinksInput,
): Promise<ProjectLinkDTO[]> {
  const row = findLiveProject(ctx.db, input.projectId);
  const inGroup = row.links.filter((link) => link.group === input.group).map((link) => link.id);
  const sameSet =
    inGroup.length === input.orderedLinkIds.length &&
    input.orderedLinkIds.every((id) => inGroup.includes(id));
  if (!sameSet) throw invalid("orderedLinkIds", VALIDATION_MESSAGES.invalidOption);

  row.links = row.links.map((link) =>
    link.group === input.group ? { ...link, order: input.orderedLinkIds.indexOf(link.id) } : link,
  );
  touch(row, ctx);
  await logProject(mockTx(ctx), ctx.user.id, "UPDATE", row, {
    changes: { links: "changed" },
    metadata: { group: input.group },
  });
  return sortLinks(row.links);
}

export async function removeProjectLink(
  ctx: MockServiceContext,
  input: RemoveProjectLinkInput,
): Promise<ProjectLinkDTO[]> {
  const row = findLiveProject(ctx.db, input.projectId);
  const link = row.links.find((item) => item.id === input.linkId);
  if (!link) throw new ServiceError("NOT_FOUND");
  row.links = renumberLinks(row.links.filter((item) => item.id !== input.linkId));
  touch(row, ctx);
  await logProject(mockTx(ctx), ctx.user.id, "UPDATE", row, {
    changes: { links: "changed" },
    metadata: { removedLabel: link.label, group: link.group },
  });
  return sortLinks(row.links);
}

/** Hints of PRD §8.3 for the status the project has just entered. */
function statusHints(db: MockStore, row: ProjectRow): ProjectStatusHint[] {
  const hints: ProjectStatusHint[] = [];
  if (row.status === "EN_CURSO" && !hasBillingPlan(db, row.id)) hints.push("NO_BILLING_PLAN");
  if (
    row.status === "MANTENIMIENTO" &&
    !db.recurringCharges.some((charge) => charge.projectId === row.id && charge.status === "ACTIVO")
  ) {
    hints.push("SUGGEST_RECURRING_CHARGE");
  }
  return hints;
}

/** `CANCELADO` options: cancels the `PENDIENTE` installments and finishes the live recurring charges. */
async function applyCancelOptions(
  ctx: MockServiceContext,
  row: ProjectRow,
  input: SetProjectStatusInput,
): Promise<{ installments: number; recurringCharges: number }> {
  const { db } = ctx;
  const tx = mockTx(ctx);
  const now = ctx.now.toISOString();
  const today = todayInCaracas(ctx.now);
  let installments = 0;
  let recurringCharges = 0;

  if (input.cancelPendingInstallments) {
    for (const installment of db.installments) {
      if (installment.projectId !== row.id || installment.status !== "PENDIENTE") continue;
      installment.status = "CANCELADA";
      installment.cancelledAt = now;
      installments += 1;
      await logActivity(tx, {
        actorType: "USER",
        actorId: ctx.user.id,
        action: "STATUS_CHANGE",
        entityType: "INSTALLMENT",
        entityId: installment.id,
        entityLabel: installment.label,
        changes: { status: ["PENDIENTE", "CANCELADA"] },
        metadata: { projectId: row.id },
      });
    }
  }
  if (input.finishRecurringCharges) {
    for (const charge of db.recurringCharges) {
      if (charge.projectId !== row.id || charge.status === "FINALIZADO") continue;
      const previous = charge.status;
      charge.status = "FINALIZADO";
      if (charge.endDate === null || charge.endDate > today) charge.endDate = today;
      charge.updatedAt = now;
      recurringCharges += 1;
      await logActivity(tx, {
        actorType: "USER",
        actorId: ctx.user.id,
        action: "STATUS_CHANGE",
        entityType: "RECURRING_CHARGE",
        entityId: charge.id,
        entityLabel: charge.label,
        changes: { status: [previous, "FINALIZADO"] },
        metadata: { projectId: row.id },
      });
    }
  }
  if (installments > 0 || recurringCharges > 0) deriveMockStore(db);
  return { installments, recurringCharges };
}

export async function setProjectStatus(
  ctx: MockServiceContext,
  input: SetProjectStatusInput,
): Promise<ProjectStatusChangeResultDTO> {
  const { db } = ctx;
  const row = findLiveProject(db, input.id);
  if (
    !PROJECT_STATUS_VALUES.includes(input.status) ||
    !canTransitionProject(row.status, input.status)
  ) {
    throw invalid("status", "projects.errors.invalidTransition");
  }

  const startDate = input.startDate ?? row.startDate ?? undefined;
  const endDate = input.endDate ?? row.endDate ?? undefined;
  if (input.status === "EN_CURSO" && !startDate) {
    throw invalid("startDate", VALIDATION_MESSAGES.required);
  }
  if (input.status === "ENTREGADO" && !endDate) {
    throw invalid("endDate", VALIDATION_MESSAGES.required);
  }
  if (startDate && endDate && endDate < startDate) {
    throw invalid("endDate", VALIDATION_MESSAGES.invalidDate);
  }
  if (input.status === "CANCELADO" && !input.confirm) {
    throw invalid("confirm", VALIDATION_MESSAGES.required);
  }

  const before = { status: row.status, startDate: row.startDate, endDate: row.endDate };
  row.status = input.status;
  row.startDate = startDate ?? null;
  row.endDate = endDate ?? null;
  touch(row, ctx);

  const cancelled =
    input.status === "CANCELADO"
      ? await applyCancelOptions(ctx, row, input)
      : { installments: 0, recurringCharges: 0 };
  const changes = diffFields(before, row, { fields: ["status", "startDate", "endDate"] });
  await logProject(mockTx(ctx), ctx.user.id, "STATUS_CHANGE", row, {
    ...(changes ? { changes } : {}),
    ...(input.status === "CANCELADO"
      ? {
          metadata: {
            cancelledInstallments: cancelled.installments,
            finishedRecurringCharges: cancelled.recurringCharges,
          },
        }
      : {}),
  });

  return { project: toDetail(ctx, row), hints: statusHints(db, row) };
}

/** Whether the project still has live billing: open installments, live recurring charges or issued invoices. */
function hasActiveBilling(db: MockStore, projectId: string): boolean {
  const openInstallment = db.installments.some(
    (item) =>
      item.projectId === projectId && item.status !== "CANCELADA" && item.status !== "COBRADA",
  );
  const liveCharge = db.recurringCharges.some(
    (item) => item.projectId === projectId && item.status !== "FINALIZADO",
  );
  const invoiced = db.invoices.some(
    (invoice) =>
      invoice.status !== "ANULADA" &&
      invoice.status !== "BORRADOR" &&
      invoice.lines.some((line) => line.project?.id === projectId),
  );
  return openInstallment || liveCharge || invoiced;
}

function assertArchivable(db: MockStore, row: ProjectRow, confirm: boolean): void {
  if (row.archivedAt) throw new ServiceError("NOT_FOUND");
  if (!confirm && hasActiveBilling(db, row.id)) {
    throw new ServiceError("INTEGRITY_LOCK", { message: "projects.errors.archiveNeedsConfirm" });
  }
}

async function archiveRow(ctx: MockServiceContext, row: ProjectRow): Promise<ArchivedRecordDTO> {
  const now = ctx.now.toISOString();
  row.archivedAt = now;
  row.deletedById = ctx.user.id;
  row.updatedAt = now;
  await logProject(mockTx(ctx), ctx.user.id, "DELETE", row, { metadata: { code: row.code } });
  return { id: row.id, archivedAt: now };
}

export async function archiveProject(
  ctx: MockServiceContext,
  input: ArchiveProjectInput,
): Promise<ArchivedRecordDTO> {
  const row = findProject(ctx.db, input.id);
  assertArchivable(ctx.db, row, input.confirm);
  return archiveRow(ctx, row);
}

/** All or none: every project is checked before the first one is archived. */
export async function archiveProjects(
  ctx: MockServiceContext,
  input: ArchiveProjectsInput,
): Promise<{ archived: ArchivedRecordDTO[] }> {
  const rows = input.ids.map((id) => findProject(ctx.db, id));
  for (const row of rows) assertArchivable(ctx.db, row, input.confirm);
  const archived: ArchivedRecordDTO[] = [];
  for (const row of rows) archived.push(await archiveRow(ctx, row));
  return { archived };
}

// ───────────────────────────── Reads ─────────────────────────────

const money = (value: string): number => Number(value);

const projectSpec: ListSpec<ProjectListRowDTO> = {
  searchText: (row) => [row.code, row.name, ...row.clients.map((item) => item.client.label)],
  sorters: {
    code: (row) => row.code,
    name: (row) => row.name,
    status: (row) => PROJECT_STATUS_VALUES.indexOf(row.status),
    startDate: (row) => row.startDate,
    targetEndDate: (row) => row.targetEndDate,
    contractedValueUsd: (row) => money(row.contractedValueUsd),
    invoicedUsd: (row) => money(row.invoicedUsd),
    collectedUsd: (row) => money(row.collectedUsd),
    toInvoiceUsd: (row) => money(row.toInvoiceUsd),
  },
  defaultSort: "code:desc",
};

/**
 * Projects of the table (PRD §8.3). `includeArchived` is honoured only for roles that can restore (trash);
 * for the others archived rows stay hidden whatever the query says (C19).
 */
export async function listProjects(
  ctx: MockServiceContext,
  input: ProjectFilter,
): Promise<Paginated<ProjectListRowDTO>> {
  const showArchived = input.includeArchived && can(ctx.user, "restore", "trash");
  const createdAt = new Map(ctx.db.projects.map((row) => [row.id, row.createdAt]));
  const rows = ctx.db.projects
    .filter((row) => showArchived || !row.archivedAt)
    .filter((row) => !input.status || input.status.includes(row.status))
    .filter(
      (row) =>
        !input.clientId || row.clients.some((link) => input.clientId?.includes(link.clientId)),
    )
    .filter(
      (row) =>
        !input.technologyId || row.technologyIds.some((id) => input.technologyId?.includes(id)),
    )
    .filter((row) => !input.tagId || row.tagIds.some((id) => input.tagId?.includes(id)))
    .filter(
      (row) =>
        (!input.deliveryFrom ||
          (row.targetEndDate !== null && row.targetEndDate >= input.deliveryFrom)) &&
        (!input.deliveryTo ||
          (row.targetEndDate !== null && row.targetEndDate <= input.deliveryTo)),
    )
    .filter((row) => !input.withoutBillingPlan || !hasBillingPlan(ctx.db, row.id))
    .map((row) => toListRow(ctx, row));
  const spec: ListSpec<ProjectListRowDTO> = {
    ...projectSpec,
    sorters: { ...projectSpec.sorters, createdAt: (row) => createdAt.get(row.id) ?? "" },
  };
  return listRows(rows, input, spec);
}

export async function getProject(
  ctx: MockServiceContext,
  input: ProjectIdInput,
): Promise<ProjectDetailDTO> {
  return toDetail(ctx, findProject(ctx.db, input.id));
}

/** `/projects` overview (PRD §8.3): archived projects never count. */
export async function getProjectsOverview(
  ctx: MockServiceContext,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- PRD §12 signature: fn(ctx, input)
  _input: GetProjectsOverviewInput,
): Promise<ProjectsOverviewDTO> {
  const { db } = ctx;
  const today = todayInCaracas(ctx.now);
  const live = db.projects.filter((row) => !row.archivedAt);

  const countByStatus = Object.fromEntries(
    PROJECT_STATUS_VALUES.map((status) => [status, live.filter((r) => r.status === status).length]),
  ) as Record<ProjectStatus, number>;

  const upcoming = live
    .filter(
      (row) =>
        (row.status === "EN_CURSO" || row.status === "PAUSADO") &&
        row.targetEndDate !== null &&
        row.targetEndDate >= today,
    )
    .sort((a, b) => (a.targetEndDate ?? "").localeCompare(b.targetEndDate ?? ""))
    .slice(0, OVERVIEW_LIST_SIZE);

  const withoutPlan = live
    .filter((row) => !hasBillingPlan(db, row.id))
    .sort((a, b) => a.code.localeCompare(b.code))
    .slice(0, OVERVIEW_LIST_SIZE);

  const usage = new Map<string, number>();
  for (const row of live) {
    for (const id of new Set(row.technologyIds)) usage.set(id, (usage.get(id) ?? 0) + 1);
  }
  const topTechnologies = compact(
    [...usage.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, TOP_TECHNOLOGIES)
      .map(([id, projectCount]) => {
        const technology = technologyChip(db, id);
        return technology ? { technology, projectCount } : null;
      }),
  );

  const highest = live
    .map((row) => toListRow(ctx, row))
    .filter((row) => compareMoney(row.toInvoiceUsd, ZERO) > 0)
    .sort((a, b) => compareMoney(b.toInvoiceUsd, a.toInvoiceUsd))
    .slice(0, OVERVIEW_LIST_SIZE);

  return {
    countByStatus,
    upcomingDeliveries: upcoming.map((row) => toListRow(ctx, row)),
    withoutBillingPlan: withoutPlan.map((row) => toListRow(ctx, row)),
    topTechnologies,
    highestToInvoice: highest,
  };
}
