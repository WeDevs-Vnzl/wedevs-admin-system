import { actorOf } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { IdGeneratorPort } from '../../../../../shared/application/ports/id-generator.port';
import { roundMoney } from '../../../../../shared/domain/money';
import type { BillingRepository } from '../../ports/billing.repository.port';
import type { CurrencyCatalogPort } from '../../ports/currency-catalog.port';
import {
  assertKnownCurrencies,
  BILLING_ERRORS,
  FieldCollector,
  invalid,
  loadPage,
  orderError,
  type BillingPageView,
} from './billing-support';
import type { BillingTransaction } from './billing-transaction';
import { validateDraft, type InstallmentDraftInput } from './apply-installment-template.use-case';

export interface CreateInstallmentInput extends InstallmentDraftInput {
  readonly projectId: string;
  readonly order?: number | undefined;
}

/**
 * `POST /projects/{id}/installments`: a manual installment of the plan (`RECURRENTE` ones come only from a
 * recurring charge). `AJUSTE` may be negative and never zero; every other kind is positive.
 */
export class CreateInstallment {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly tx: BillingTransaction,
    private readonly repository: BillingRepository,
    private readonly currencies: CurrencyCatalogPort,
    private readonly ids: IdGeneratorPort,
  ) {}

  async execute(actor: CurrentUser, input: CreateInstallmentInput): Promise<BillingPageView> {
    assertCan(this.authorization, actor, 'create', 'billing');
    const errors = new FieldCollector();
    validateDraft(input, '', errors);
    if (input.order !== undefined) {
      const order = orderError(input.order);
      if (order !== null) errors.add('order', order);
    }
    errors.throwIfAny();

    await this.tx.requireProject(input.projectId);
    const stored = await this.repository.findPlan(input.projectId);
    if (stored === null) throw invalid('projectId', BILLING_ERRORS.planRequired);

    return this.tx.run(
      actorOf(actor),
      input.projectId,
      { BillingPlan: [stored.id] },
      async (project) => {
        const plan = await this.repository.findPlan(project.id);
        if (plan === null) throw invalid('projectId', BILLING_ERRORS.planRequired);
        await assertKnownCurrencies(this.currencies, [{ path: 'currency', code: input.currency }]);
        const id = this.ids.next();
        await this.repository.insertInstallments([
          {
            id,
            projectId: project.id,
            billingPlanId: plan.id,
            recurringChargeId: null,
            kind: input.kind,
            label: input.label,
            amount: roundMoney(input.amount),
            currency: input.currency,
            percentage: input.percentage ?? null,
            dueDate: input.dueDate ?? null,
            trigger: input.trigger ?? null,
            periodStart: null,
            periodEnd: null,
            order: input.order ?? (await this.repository.maxInstallmentOrder(project.id)) + 1,
          },
        ]);
        return {
          value: await loadPage(this.repository, project.id),
          changed: true,
          activity: [
            {
              action: 'CREATE',
              entityType: 'INSTALLMENT',
              entityId: id,
              entityLabel: input.label,
              metadata: { projectId: project.id },
            },
          ],
        };
      },
    );
  }
}
