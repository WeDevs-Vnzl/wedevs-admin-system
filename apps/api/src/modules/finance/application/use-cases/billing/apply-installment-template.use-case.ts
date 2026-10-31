import { actorOf } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import type { IdGeneratorPort } from '../../../../../shared/application/ports/id-generator.port';
import { ConflictError } from '../../../../../shared/domain/domain-error';
import type { DateOnly } from '../../../../../shared/domain/business-date';
import type { InstallmentKind } from '../../../../../shared/domain/enums';
import { roundMoney, type MoneyString } from '../../../../../shared/domain/money';
import {
  INSTALLMENT_TEMPLATE_VALUES,
  splitByTemplate,
  type InstallmentTemplate,
} from '../../../domain/installments';
import type {
  BillingPlanRecord,
  BillingRepository,
  NewInstallment,
} from '../../ports/billing.repository.port';
import type { CurrencyCatalogPort } from '../../ports/currency-catalog.port';
import {
  assertKnownCurrencies,
  BILLING_MESSAGES,
  currencyShapeError,
  dateError,
  FieldCollector,
  installmentAmountError,
  invalid,
  isInstallmentKind,
  labelError,
  loadPage,
  MAX_CUSTOM_INSTALLMENTS,
  percentageError,
  triggerError,
  BILLING_ERRORS,
  type BillingPageView,
} from './billing-support';
import type { BillingTransaction } from './billing-transaction';

export interface InstallmentDraftInput {
  readonly kind: InstallmentKind;
  readonly label: string;
  readonly amount: MoneyString;
  readonly currency: string;
  readonly percentage?: MoneyString | null | undefined;
  readonly dueDate?: DateOnly | null | undefined;
  readonly trigger?: string | null | undefined;
}

export interface ApplyInstallmentTemplateInput {
  readonly projectId: string;
  readonly template: InstallmentTemplate;
  /** Cancel the pending template installments first (default) or append to them. */
  readonly replacePending?: boolean;
  /** The installments of a `CUSTOM` template; not allowed with a fixed one. */
  readonly installments?: readonly InstallmentDraftInput[] | undefined;
}

/** Validates one installment draft (`kind`, label, amount rule of its kind, currency, schedule fields). */
export function validateDraft(
  draft: InstallmentDraftInput,
  prefix: string,
  errors: FieldCollector,
): void {
  const at = (field: string) => (prefix === '' ? field : `${prefix}.${field}`);
  if (!isInstallmentKind(draft.kind) || draft.kind === 'RECURRENTE') {
    errors.add(at('kind'), BILLING_MESSAGES.installmentKindNotManual);
    return;
  }
  const checks: [string, string | null][] = [
    ['label', labelError(draft.label)],
    ['amount', installmentAmountError(draft.kind, draft.amount)],
    ['currency', currencyShapeError(draft.currency)],
  ];
  if (draft.percentage != null) checks.push(['percentage', percentageError(draft.percentage)]);
  if (draft.dueDate != null) checks.push(['dueDate', dateError(draft.dueDate)]);
  if (draft.trigger != null) checks.push(['trigger', triggerError(draft.trigger)]);
  for (const [field, key] of checks) if (key !== null) errors.add(at(field), key);
}

/**
 * `POST /projects/{id}/billing-plan/template` (HU-09 CA1). Generates the installments of the plan from a
 * fixed template (the split of the contract by `splitByTemplate`, the last part absorbs the remainder) or
 * from the supplied drafts for `CUSTOM`. With `replacePending` (default) the pending template installments
 * are cancelled first, billed and recurring ones never; those rows are locked up front with the plan.
 */
export class ApplyInstallmentTemplate {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly tx: BillingTransaction,
    private readonly repository: BillingRepository,
    private readonly currencies: CurrencyCatalogPort,
    private readonly clock: ClockPort,
    private readonly ids: IdGeneratorPort,
  ) {}

  async execute(
    actor: CurrentUser,
    input: ApplyInstallmentTemplateInput,
  ): Promise<BillingPageView> {
    assertCan(this.authorization, actor, 'create', 'billing');
    const replacePending = input.replacePending ?? true;
    this.validate(input);

    await this.tx.requireProject(input.projectId);
    const stored = await this.repository.findPlan(input.projectId);
    if (stored === null) throw invalid('projectId', BILLING_ERRORS.planRequired);
    const pendingIds = replacePending ? await this.pendingIds(stored) : [];

    return this.tx.run(
      actorOf(actor),
      input.projectId,
      {
        BillingPlan: [stored.id],
        ...(pendingIds.length > 0 ? { BillingInstallment: pendingIds } : {}),
      },
      async (project) => {
        const plan = await this.repository.findPlan(project.id);
        if (plan === null) throw invalid('projectId', BILLING_ERRORS.planRequired);
        const drafts = this.draftsOf(input, plan);
        await assertKnownCurrencies(
          this.currencies,
          drafts.map((draft, index) => ({
            path: `installments.${index}.currency`,
            code: draft.currency,
          })),
        );
        const now = this.clock.now();

        const cancelled = replacePending ? await this.pendingIds(plan) : [];
        if (cancelled.some((id) => !pendingIds.includes(id))) throw new ConflictError();
        const cancelledRows = (await this.repository.listInstallments(project.id)).filter((item) =>
          cancelled.includes(item.id),
        );
        if (cancelled.length > 0) await this.repository.cancelInstallments(cancelled, now);

        let order = (await this.repository.maxInstallmentOrder(project.id)) + 1;
        const rows: NewInstallment[] = drafts.map((draft) => ({
          id: this.ids.next(),
          projectId: project.id,
          billingPlanId: plan.id,
          recurringChargeId: null,
          kind: draft.kind,
          label: draft.label,
          amount: roundMoney(draft.amount),
          currency: draft.currency,
          percentage: draft.percentage ?? null,
          dueDate: draft.dueDate ?? null,
          trigger: draft.trigger ?? null,
          periodStart: null,
          periodEnd: null,
          order: order++,
        }));
        await this.repository.insertInstallments(rows);

        return {
          value: await loadPage(this.repository, project.id),
          changed: true,
          activity: [
            ...cancelledRows.map((row) => ({
              action: 'STATUS_CHANGE' as const,
              entityType: 'INSTALLMENT' as const,
              entityId: row.id,
              entityLabel: row.label,
              changes: { status: ['PENDIENTE', 'CANCELADA'] },
              metadata: { projectId: project.id },
            })),
            ...rows.map((row) => ({
              action: 'CREATE' as const,
              entityType: 'INSTALLMENT' as const,
              entityId: row.id,
              entityLabel: row.label,
              metadata: { projectId: project.id },
            })),
          ],
        };
      },
    );
  }

  /** Pending, unbilled template installments of the plan: recurring ones are never replaced. */
  private async pendingIds(plan: BillingPlanRecord): Promise<string[]> {
    return (await this.repository.listInstallments(plan.projectId))
      .filter(
        (item) =>
          item.billingPlanId === plan.id &&
          item.kind !== 'RECURRENTE' &&
          item.status === 'PENDIENTE' &&
          item.cancelledAt === null &&
          !item.locked,
      )
      .map((item) => item.id);
  }

  private draftsOf(
    input: ApplyInstallmentTemplateInput,
    plan: BillingPlanRecord,
  ): InstallmentDraftInput[] {
    if (input.template === 'CUSTOM') return [...(input.installments ?? [])];
    if (plan.contractAmount === null) {
      throw invalid('template', BILLING_MESSAGES.contractAmountRequired);
    }
    return splitByTemplate(input.template, plan.contractAmount).map((part, index) => ({
      kind: 'CUOTA',
      label: `Cuota ${index + 1}`,
      amount: part.amount,
      currency: plan.currency,
      percentage: part.percentage,
    }));
  }

  private validate(input: ApplyInstallmentTemplateInput): void {
    const errors = new FieldCollector();
    if (!(INSTALLMENT_TEMPLATE_VALUES as readonly unknown[]).includes(input.template)) {
      errors.add('template', BILLING_MESSAGES.required);
    }
    const supplied = input.installments?.length ?? 0;
    if (input.template === 'CUSTOM' && supplied === 0) {
      errors.add('installments', BILLING_MESSAGES.customInstallmentsRequired);
    }
    if (input.template !== 'CUSTOM' && supplied > 0) {
      errors.add('installments', BILLING_MESSAGES.templateInstallmentsNotAllowed);
    }
    if (supplied > MAX_CUSTOM_INSTALLMENTS) errors.add('installments', BILLING_MESSAGES.required);
    (input.installments ?? []).forEach((draft, index) =>
      validateDraft(draft, `installments.${index}`, errors),
    );
    errors.throwIfAny();
  }
}
