// MOCK — billing services of Hito 1 (PRD §8.4, HU-09, HU-10). `fn(ctx, input)`, framework-free (C11).
// Replaced by `src/server/services/billing.service.ts` in Hito 2 (C9). Every formula comes from `src/lib/finance`
// (C17): the template split, the sum check, the lock and the status of an installment, the period schedule
// and the monthly amount (the derive pass). The USD snapshot of the contract is taken at plan save and never
// recomputed (D1, C16).
import { addDays, todayInCaracas, type DateOnly } from "@/lib/dates";
import { dueRecurringPeriods, splitByTemplate } from "@/lib/finance";
import {
  compareMoney,
  isNegativeMoney,
  isZeroMoney,
  roundMoney,
  toUsd,
  type MoneyString,
} from "@/lib/money";
import { selectRate } from "@/lib/rates";
import {
  BILLING_MESSAGES,
  type ApplyInstallmentTemplateInput,
  type BillingPlanDTO,
  type CreateInstallmentInput,
  type CreateRecurringChargeInput,
  type GenerateMissingPeriodsInput,
  type GenerateMissingPeriodsResult,
  type InstallmentDTO,
  type InstallmentDraft,
  type RecurringChargeDTO,
  type SetRecurringChargeStatusInput,
  type UpdateInstallmentInput,
  type UpdateRecurringChargeInput,
  type UpsertBillingPlanInput,
} from "@/lib/validators/billing";
import { VALIDATION_MESSAGES } from "@/lib/validators/common";
import type { MockServiceContext } from "../ctx";
import { ServiceError } from "../ctx";
import { nextMockId } from "../ids";
import type { MockStore } from "../store";
import { deriveMockStore } from "../store";
import { logActivity, mockTx } from "./activity";

/** Message keys of the domain errors (`billing.errors.*`), shown by the form or the toast. */
export const BILLING_ERRORS = {
  planRequired: "billing.errors.planRequired",
  rateMissing: "billing.errors.rateMissing",
  currencyLocked: "billing.errors.currencyLocked",
  installmentBilled: "billing.errors.installmentBilled",
  installmentCancelled: "billing.errors.installmentCancelled",
  chargeFinished: "billing.errors.chargeFinished",
} as const;

/** Guard on the periods one generation may create; a sane schedule never reaches it. */
const MAX_PERIODS_PER_RUN = 24;

/** The stored plan; the DTO carries the D1 snapshot (`contractedUsd`, `usdRate`), fixed at plan save (C16). */
export type BillingPlanRow = BillingPlanDTO;

/** Everything the billing screen reads for one project. */
export interface BillingPageDTO {
  projectId: string;
  plan: BillingPlanRow | null;
  /** Every installment of the project (template, manual or recurring), by `order`; cancelled ones included. */
  installments: InstallmentDTO[];
  recurringCharges: RecurringChargeDTO[];
}

// ───────────────────────────── Lookups and helpers ─────────────────────────────

function invalid(field: string, key: string): ServiceError {
  return new ServiceError("VALIDATION", { fieldErrors: { [field]: [key] } });
}

/** The project of a billing call: unknown and archived projects are `NOT_FOUND` (never trust a client id). */
function liveProject(db: MockStore, projectId: string) {
  const row = db.projects.find((item) => item.id === projectId);
  if (!row || row.archivedAt) throw new ServiceError("NOT_FOUND");
  return row;
}

function planRows(db: MockStore): BillingPlanRow[] {
  return db.billingPlans;
}

function planOf(db: MockStore, projectId: string): BillingPlanRow | undefined {
  return planRows(db).find((plan) => plan.projectId === projectId);
}

function requirePlan(db: MockStore, projectId: string): BillingPlanRow {
  const plan = planOf(db, projectId);
  if (!plan) throw invalid("projectId", BILLING_ERRORS.planRequired);
  return plan;
}

function findInstallment(db: MockStore, id: string): InstallmentDTO {
  const row = db.installments.find((item) => item.id === id);
  if (!row) throw new ServiceError("NOT_FOUND");
  liveProject(db, row.projectId);
  return row;
}

function findCharge(db: MockStore, id: string): RecurringChargeDTO {
  const row = db.recurringCharges.find((item) => item.id === id);
  if (!row) throw new ServiceError("NOT_FOUND");
  liveProject(db, row.projectId);
  return row;
}

function nextOrder(db: MockStore, projectId: string): number {
  return (
    db.installments
      .filter((item) => item.projectId === projectId)
      .reduce((max, item) => Math.max(max, item.order), -1) + 1
  );
}

/** Snapshot of the contract in USD at the rate of `today` (D1). A non-USD contract needs a rate. */
function snapshotFor(
  db: MockStore,
  today: DateOnly,
  currency: string,
  contract: MoneyString | null,
): Pick<BillingPlanRow, "contractedUsd" | "usdRate"> {
  const rate = selectRate(db.exchangeRates, today, currency);
  if (contract === null) return { contractedUsd: null, usdRate: rate?.usdRate ?? null };
  if (!rate) throw invalid("currency", BILLING_ERRORS.rateMissing);
  return { contractedUsd: toUsd(contract, rate.usdRate), usdRate: rate.usdRate };
}

function pageOf(db: MockStore, projectId: string): BillingPageDTO {
  const plan = planOf(db, projectId);
  return {
    projectId,
    plan: plan ? structuredClone(plan) : null,
    installments: db.installments
      .filter((item) => item.projectId === projectId)
      .sort((a, b) => a.order - b.order)
      .map((item) => structuredClone(item)),
    recurringCharges: db.recurringCharges
      .filter((item) => item.projectId === projectId)
      .map((item) => structuredClone(item)),
  };
}

type NewInstallment = Pick<
  InstallmentDTO,
  | "projectId"
  | "billingPlanId"
  | "recurringChargeId"
  | "kind"
  | "label"
  | "amount"
  | "currency"
  | "order"
> &
  Partial<Pick<InstallmentDTO, "percentage" | "dueDate" | "trigger" | "periodStart" | "periodEnd">>;

/** A new installment: pending, never billed, its derived fields filled by the derive pass. */
function newInstallment(db: MockStore, fields: NewInstallment): InstallmentDTO {
  return {
    id: nextMockId(db.idCounters, "ins", (value) =>
      db.installments.some((item) => item.id === value),
    ),
    projectId: fields.projectId,
    billingPlanId: fields.billingPlanId,
    recurringChargeId: fields.recurringChargeId,
    kind: fields.kind,
    label: fields.label,
    amount: roundMoney(fields.amount),
    currency: fields.currency,
    percentage: fields.percentage ?? null,
    dueDate: fields.dueDate ?? null,
    trigger: fields.trigger ?? null,
    periodStart: fields.periodStart ?? null,
    periodEnd: fields.periodEnd ?? null,
    order: fields.order,
    status: "PENDIENTE",
    cancelledAt: null,
    invoicedAmount: "0.00",
    locked: false,
  };
}

function logInstallment(
  ctx: MockServiceContext,
  action: "CREATE" | "UPDATE" | "STATUS_CHANGE",
  row: InstallmentDTO,
) {
  return logActivity(mockTx(ctx), {
    actorType: "USER",
    actorId: ctx.user.id,
    action,
    entityType: "INSTALLMENT",
    entityId: row.id,
    entityLabel: row.label,
    metadata: { projectId: row.projectId },
  });
}

// ───────────────────────────── Reads ─────────────────────────────

/** The billing screen of a project (PRD §8.4): plan, installments and recurring charges. */
export async function getBillingPage(
  ctx: MockServiceContext,
  projectId: string,
): Promise<BillingPageDTO> {
  liveProject(ctx.db, projectId);
  return pageOf(ctx.db, projectId);
}

// ───────────────────────────── Billing plan (HU-09 CA1, D1) ─────────────────────────────

/**
 * Creates or updates the plan of a project. The USD snapshot (`contractedUsd`, `usdRate`) is taken from the rate
 * of the day when the contract amount or the currency changes; saving the plan without changing them keeps the
 * snapshot as it was (D1, C16). A billed installment blocks a currency change.
 */
export async function upsertBillingPlan(
  ctx: MockServiceContext,
  input: UpsertBillingPlanInput,
): Promise<BillingPageDTO> {
  const { db } = ctx;
  const project = liveProject(db, input.projectId);
  const today = todayInCaracas(ctx.now);
  const now = ctx.now.toISOString();
  const contract = input.contractAmount === undefined ? null : roundMoney(input.contractAmount);
  const existing = planOf(db, project.id);

  let snapshot: Pick<BillingPlanRow, "contractedUsd" | "usdRate">;
  if (existing) {
    const billed = db.installments.some(
      (item) => item.billingPlanId === existing.id && item.locked,
    );
    if (existing.currency !== input.currency && billed) {
      throw new ServiceError("INTEGRITY_LOCK", { message: BILLING_ERRORS.currencyLocked });
    }
    const sameContract =
      existing.contractAmount === null || contract === null
        ? existing.contractAmount === contract
        : compareMoney(existing.contractAmount, contract) === 0;
    snapshot =
      sameContract && existing.currency === input.currency
        ? { contractedUsd: existing.contractedUsd, usdRate: existing.usdRate }
        : snapshotFor(db, today, input.currency, contract);
  } else {
    snapshot = snapshotFor(db, today, input.currency, contract);
  }

  const plan: BillingPlanRow = {
    id:
      existing?.id ??
      nextMockId(db.idCounters, "bpl", (value) => planRows(db).some((item) => item.id === value)),
    projectId: project.id,
    model: input.model,
    currency: input.currency,
    contractAmount: contract,
    notes: input.notes ?? null,
    installments: existing?.installments ?? [],
    installmentsTotal: existing?.installmentsTotal ?? "0.00",
    scheduleDifference: existing?.scheduleDifference ?? null,
    scheduleConsistent: existing?.scheduleConsistent ?? true,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...snapshot,
  };
  if (existing) Object.assign(existing, plan);
  else db.billingPlans.push(plan);

  deriveMockStore(db);
  await logActivity(mockTx(ctx), {
    actorType: "USER",
    actorId: ctx.user.id,
    action: existing ? "UPDATE" : "CREATE",
    entityType: "BILLING_PLAN",
    entityId: plan.id,
    entityLabel: project.code,
    metadata: { projectId: project.id, model: plan.model, currency: plan.currency },
  });
  return pageOf(db, project.id);
}

// ───────────────────────────── Installments (HU-09 CA1, CA3) ─────────────────────────────

/** The drafts of a fixed template: the split of the contract by `lib/finance` (HU-09 CA1). */
function templateDrafts(
  template: Exclude<ApplyInstallmentTemplateInput["template"], "CUSTOM">,
  plan: BillingPlanRow,
): InstallmentDraft[] {
  if (plan.contractAmount === null) {
    throw invalid("template", BILLING_MESSAGES.contractAmountRequired);
  }
  return splitByTemplate(template, plan.contractAmount).map((part, index): InstallmentDraft => ({
    kind: "CUOTA",
    label: `Cuota ${index + 1}`,
    amount: part.amount,
    currency: plan.currency,
    percentage: part.percentage,
    dueDate: undefined,
    trigger: undefined,
  }));
}

/**
 * Generates the installments of a plan from a template, or from the supplied drafts for `CUSTOM`. With
 * `replacePending` (default) the pending template installments are cancelled first; billed ones and recurring
 * ones are never touched.
 */
export async function applyInstallmentTemplate(
  ctx: MockServiceContext,
  input: ApplyInstallmentTemplateInput,
): Promise<BillingPageDTO> {
  const { db } = ctx;
  const project = liveProject(db, input.projectId);
  const plan = requirePlan(db, project.id);
  const drafts =
    input.template === "CUSTOM" ? (input.installments ?? []) : templateDrafts(input.template, plan);
  const now = ctx.now.toISOString();

  if (input.replacePending) {
    for (const item of db.installments) {
      if (
        item.billingPlanId === plan.id &&
        item.kind !== "RECURRENTE" &&
        item.status === "PENDIENTE" &&
        item.cancelledAt === null
      ) {
        item.cancelledAt = now;
      }
    }
  }

  let order = nextOrder(db, project.id);
  const created: InstallmentDTO[] = [];
  for (const draft of drafts) {
    const row = newInstallment(db, {
      projectId: project.id,
      billingPlanId: plan.id,
      recurringChargeId: null,
      kind: draft.kind,
      label: draft.label,
      amount: draft.amount,
      currency: draft.currency,
      order,
      percentage: draft.percentage,
      dueDate: draft.dueDate,
      trigger: draft.trigger,
    });
    order += 1;
    db.installments.push(row);
    created.push(row);
  }

  deriveMockStore(db);
  for (const row of created) await logInstallment(ctx, "CREATE", row);
  return pageOf(db, project.id);
}

/** A manual installment of the plan (`RECURRENTE` ones come from a recurring charge only). */
export async function createInstallment(
  ctx: MockServiceContext,
  input: CreateInstallmentInput,
): Promise<BillingPageDTO> {
  const { db } = ctx;
  const project = liveProject(db, input.projectId);
  const plan = requirePlan(db, project.id);
  const row = newInstallment(db, {
    projectId: project.id,
    billingPlanId: plan.id,
    recurringChargeId: null,
    kind: input.kind,
    label: input.label,
    amount: input.amount,
    currency: input.currency,
    order: input.order ?? nextOrder(db, project.id),
    percentage: input.percentage,
    dueDate: input.dueDate,
    trigger: input.trigger,
  });
  db.installments.push(row);
  deriveMockStore(db);
  await logInstallment(ctx, "CREATE", row);
  return pageOf(db, project.id);
}

/**
 * Edits an installment. A billed installment (a live invoice line references it) keeps its amount and currency
 * (HU-09 CA3, C19); the label and the schedule fields stay editable. A cancelled one is read-only.
 */
export async function updateInstallment(
  ctx: MockServiceContext,
  input: UpdateInstallmentInput,
): Promise<BillingPageDTO> {
  const { db } = ctx;
  const row = findInstallment(db, input.id);
  if (row.cancelledAt !== null) {
    throw new ServiceError("CONFLICT", { message: BILLING_ERRORS.installmentCancelled });
  }

  const amount = input.amount === undefined ? undefined : roundMoney(input.amount);
  if (amount !== undefined) {
    if (isZeroMoney(amount)) {
      throw invalid(
        "amount",
        row.kind === "AJUSTE"
          ? BILLING_MESSAGES.adjustmentNonZero
          : VALIDATION_MESSAGES.moneyMustBePositive,
      );
    }
    if (row.kind !== "AJUSTE" && isNegativeMoney(amount)) {
      throw invalid("amount", VALIDATION_MESSAGES.moneyMustBePositive);
    }
  }
  // A billed installment only accepts a new label (C19): any other field that changes is refused.
  const nonLabelChanged =
    (amount !== undefined && compareMoney(amount, row.amount) !== 0) ||
    (input.currency !== undefined && input.currency !== row.currency) ||
    (input.percentage !== undefined &&
      (row.percentage === null || compareMoney(input.percentage, row.percentage) !== 0)) ||
    (input.dueDate !== undefined && input.dueDate !== row.dueDate) ||
    (input.trigger !== undefined && input.trigger !== row.trigger) ||
    (input.order !== undefined && input.order !== row.order);
  if (row.locked && nonLabelChanged) {
    throw new ServiceError("INTEGRITY_LOCK", { message: BILLING_ERRORS.installmentBilled });
  }

  if (input.label !== undefined) row.label = input.label;
  if (amount !== undefined) row.amount = amount;
  if (input.currency !== undefined) row.currency = input.currency;
  if (input.percentage !== undefined) row.percentage = input.percentage;
  if (input.dueDate !== undefined) row.dueDate = input.dueDate;
  if (input.trigger !== undefined) row.trigger = input.trigger;
  if (input.order !== undefined) row.order = input.order;

  deriveMockStore(db);
  await logInstallment(ctx, "UPDATE", row);
  return pageOf(db, row.projectId);
}

/** Cancels an installment that no live invoice references (it stays in the list as cancelled). */
export async function cancelInstallment(
  ctx: MockServiceContext,
  input: { id: string },
): Promise<BillingPageDTO> {
  const { db } = ctx;
  const row = findInstallment(db, input.id);
  if (row.cancelledAt !== null) {
    throw new ServiceError("CONFLICT", { message: BILLING_ERRORS.installmentCancelled });
  }
  if (row.locked)
    throw new ServiceError("INTEGRITY_LOCK", { message: BILLING_ERRORS.installmentBilled });
  row.cancelledAt = ctx.now.toISOString();
  deriveMockStore(db);
  await logInstallment(ctx, "STATUS_CHANGE", row);
  return pageOf(db, row.projectId);
}

// ───────────────────────────── Recurring charges (HU-10) ─────────────────────────────

export async function createRecurringCharge(
  ctx: MockServiceContext,
  input: CreateRecurringChargeInput,
): Promise<BillingPageDTO> {
  const { db } = ctx;
  const project = liveProject(db, input.projectId);
  const now = ctx.now.toISOString();
  const row: RecurringChargeDTO = {
    id: nextMockId(db.idCounters, "rch", (value) =>
      db.recurringCharges.some((item) => item.id === value),
    ),
    projectId: project.id,
    label: input.label,
    amount: roundMoney(input.amount),
    currency: input.currency,
    frequency: input.frequency,
    startDate: input.startDate,
    endDate: input.endDate ?? null,
    billingDay: input.billingDay,
    leadDays: input.leadDays,
    status: "ACTIVO",
    lastGeneratedPeriodStart: null,
    // Placeholder: the derive pass normalizes it to a month (lib/finance, C17).
    monthlyAmount: roundMoney(input.amount),
    createdAt: now,
    updatedAt: now,
  };
  db.recurringCharges.push(row);
  deriveMockStore(db);
  await logActivity(mockTx(ctx), {
    actorType: "USER",
    actorId: ctx.user.id,
    action: "CREATE",
    entityType: "RECURRING_CHARGE",
    entityId: row.id,
    entityLabel: row.label,
    metadata: { projectId: project.id, frequency: row.frequency },
  });
  return pageOf(db, project.id);
}

/** Changing the amount affects only the periods not generated yet: generated installments are not touched. */
export async function updateRecurringCharge(
  ctx: MockServiceContext,
  input: UpdateRecurringChargeInput,
): Promise<BillingPageDTO> {
  const { db } = ctx;
  const row = findCharge(db, input.id);
  if (row.status === "FINALIZADO") {
    throw new ServiceError("CONFLICT", { message: BILLING_ERRORS.chargeFinished });
  }
  row.label = input.label;
  row.amount = roundMoney(input.amount);
  row.currency = input.currency;
  row.frequency = input.frequency;
  row.startDate = input.startDate;
  row.endDate = input.endDate ?? null;
  row.billingDay = input.billingDay;
  row.leadDays = input.leadDays;
  row.updatedAt = ctx.now.toISOString();
  deriveMockStore(db);
  await logActivity(mockTx(ctx), {
    actorType: "USER",
    actorId: ctx.user.id,
    action: "UPDATE",
    entityType: "RECURRING_CHARGE",
    entityId: row.id,
    entityLabel: row.label,
    metadata: { projectId: row.projectId },
  });
  return pageOf(db, row.projectId);
}

/** Pauses, resumes or finishes a charge. A finished charge is final. */
export async function setRecurringChargeStatus(
  ctx: MockServiceContext,
  input: SetRecurringChargeStatusInput,
): Promise<BillingPageDTO> {
  const { db } = ctx;
  const row = findCharge(db, input.id);
  if (row.status === input.status) return pageOf(db, row.projectId);
  if (row.status === "FINALIZADO") {
    throw new ServiceError("CONFLICT", { message: BILLING_ERRORS.chargeFinished });
  }
  const previous = row.status;
  row.status = input.status;
  row.updatedAt = ctx.now.toISOString();
  await logActivity(mockTx(ctx), {
    actorType: "USER",
    actorId: ctx.user.id,
    action: "STATUS_CHANGE",
    entityType: "RECURRING_CHARGE",
    entityId: row.id,
    entityLabel: row.label,
    changes: { status: [previous, input.status] },
    metadata: { projectId: row.projectId },
  });
  return pageOf(db, row.projectId);
}

/**
 * Creates the installments of one charge that are due by `asOf`: one period per step, each with its own
 * `generateOn` reached, never a period twice (HU-10 CA1, CA2). Paused and finished charges generate nothing
 * (CA3) unless `ignoreStatus` asks for the on-request path.
 */
function generatePeriods(
  db: MockStore,
  charge: RecurringChargeDTO,
  asOf: DateOnly,
  options: { ignoreStatus?: boolean } = {},
): DateOnly[] {
  const plan = planOf(db, charge.projectId);
  const schedule = {
    frequency: charge.frequency,
    startDate: charge.startDate,
    endDate: charge.endDate,
    billingDay: charge.billingDay,
    leadDays: charge.leadDays,
    status: options.ignoreStatus ? ("ACTIVO" as const) : charge.status,
  };
  const created: DateOnly[] = [];
  for (let guard = 0; guard < MAX_PERIODS_PER_RUN; guard += 1) {
    const existing = db.installments
      .filter((item) => item.recurringChargeId === charge.id)
      .flatMap((item) => (item.periodStart === null ? [] : [item.periodStart]));
    const [due] = dueRecurringPeriods(schedule, existing, asOf);
    if (!due) break;
    const order = nextOrder(db, charge.projectId);
    db.installments.push(
      newInstallment(db, {
        projectId: charge.projectId,
        billingPlanId: plan?.id ?? null,
        recurringChargeId: charge.id,
        kind: "RECURRENTE",
        label: `${charge.label} · ${due.periodStart}`,
        amount: charge.amount,
        currency: charge.currency,
        order,
        dueDate: due.periodStart,
        periodStart: due.periodStart,
        periodEnd: due.periodEnd,
      }),
    );
    charge.lastGeneratedPeriodStart = due.periodStart;
    created.push(due.periodStart);
  }
  return created;
}

/**
 * The daily job of the recurring charges (HU-10 CA1–CA3): generates every due period of every active charge as
 * of the business day. Running it twice on the same day creates nothing the second time.
 */
export async function runRecurringGeneration(
  ctx: MockServiceContext,
): Promise<GenerateMissingPeriodsResult> {
  const { db } = ctx;
  const today = todayInCaracas(ctx.now);
  const periodStarts: DateOnly[] = [];
  for (const charge of db.recurringCharges) {
    if (charge.status !== "ACTIVO") continue;
    const created = generatePeriods(db, charge, today);
    if (created.length === 0) continue;
    periodStarts.push(...created);
    await logActivity(mockTx(ctx), {
      actorType: "SYSTEM",
      actorId: null,
      action: "SYSTEM_JOB",
      entityType: "RECURRING_CHARGE",
      entityId: charge.id,
      entityLabel: charge.label,
      metadata: { projectId: charge.projectId, created: created.length },
    });
  }
  if (periodStarts.length > 0) deriveMockStore(db);
  return { created: periodStarts.length, periodStarts };
}

/**
 * "Generate missing periods" on request: periods skipped while a charge was paused are created up to `upTo`
 * (default: the lead days after today). It is the only path that generates for a paused charge.
 */
export async function generateMissingPeriods(
  ctx: MockServiceContext,
  input: GenerateMissingPeriodsInput,
): Promise<GenerateMissingPeriodsResult> {
  const { db } = ctx;
  const charge = findCharge(db, input.recurringChargeId);
  if (charge.status === "FINALIZADO") {
    throw new ServiceError("CONFLICT", { message: BILLING_ERRORS.chargeFinished });
  }
  const today = todayInCaracas(ctx.now);
  const upTo = input.upTo ?? addDays(today, charge.leadDays);
  const periodStarts = generatePeriods(db, charge, upTo, { ignoreStatus: true });
  if (periodStarts.length > 0) {
    deriveMockStore(db);
    await logActivity(mockTx(ctx), {
      actorType: "USER",
      actorId: ctx.user.id,
      action: "CREATE",
      entityType: "RECURRING_CHARGE",
      entityId: charge.id,
      entityLabel: charge.label,
      metadata: { projectId: charge.projectId, created: periodStarts.length },
    });
  }
  return { created: periodStarts.length, periodStarts };
}
