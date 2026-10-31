import { actorOf } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import type { IdGeneratorPort } from '../../../../../shared/application/ports/id-generator.port';
import { todayInCaracas } from '../../../../../shared/domain/business-date';
import { IntegrityLockedError } from '../../../../../shared/domain/domain-error';
import { BILLING_MODEL_VALUES, type BillingModel } from '../../../../../shared/domain/enums';
import {
  compareMoney,
  roundMoney,
  toUsd,
  type MoneyString,
} from '../../../../../shared/domain/money';
import { ConflictError } from '../../../../../shared/domain/domain-error';
import type { BillingRepository } from '../../ports/billing.repository.port';
import type { CurrencyCatalogPort } from '../../ports/currency-catalog.port';
import type { ExchangeRatePort } from '../../ports/exchange-rate.port';
import {
  assertKnownCurrencies,
  BILLING_ERRORS,
  BILLING_MESSAGES,
  currencyShapeError,
  FieldCollector,
  invalid,
  loadPage,
  notesError,
  positiveAmountError,
  usdRateOn,
  type BillingPageView,
} from './billing-support';
import type { BillingTransaction } from './billing-transaction';

export interface UpsertBillingPlanInput {
  readonly projectId: string;
  readonly model: BillingModel;
  readonly currency: string;
  /** Required for fixed-price and mixed plans. */
  readonly contractAmount?: MoneyString | null | undefined;
  readonly notes?: string | null | undefined;
}

/**
 * `PUT /projects/{id}/billing-plan` (PRD §8.4, HU-09 CA1, D1). Creates or updates the plan of a project.
 * The USD snapshot (`contractedUsd`, `usdRate`) is taken at the rate of the business day when the contract
 * amount or the currency changes; saving the plan without changing them keeps the snapshot (C16). A billed
 * installment blocks a currency change (`INTEGRITY_LOCK`, C19): when the currency changes the installments
 * of the plan are locked up front, in the global order, so a concurrent invoice cannot slip in.
 */
export class UpsertBillingPlan {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly tx: BillingTransaction,
    private readonly repository: BillingRepository,
    private readonly rates: ExchangeRatePort,
    private readonly currencies: CurrencyCatalogPort,
    private readonly clock: ClockPort,
    private readonly ids: IdGeneratorPort,
  ) {}

  async execute(actor: CurrentUser, input: UpsertBillingPlanInput): Promise<BillingPageView> {
    assertCan(this.authorization, actor, 'update', 'billing');
    const contract =
      input.contractAmount === undefined || input.contractAmount === null
        ? null
        : roundMoney(input.contractAmount);
    this.validate(input);

    const stored = await this.repository.findPlan(input.projectId);
    const currencyChanges = stored !== null && stored.currency !== input.currency;
    const installmentIds = currencyChanges
      ? (await this.repository.billingIdsOf(input.projectId)).installmentIds
      : [];

    return this.tx.run(
      actorOf(actor),
      input.projectId,
      {
        ...(stored ? { BillingPlan: [stored.id] } : {}),
        ...(installmentIds.length > 0 ? { BillingInstallment: installmentIds } : {}),
      },
      async (project) => {
        await assertKnownCurrencies(this.currencies, [{ path: 'currency', code: input.currency }]);
        const existing = await this.repository.findPlan(project.id);
        if (
          existing?.id !== stored?.id ||
          (existing && currencyChanges !== (existing.currency !== input.currency))
        ) {
          throw new ConflictError();
        }
        const now = this.clock.now();
        const today = todayInCaracas(now);

        let snapshot: { contractedUsd: MoneyString | null; usdRate: MoneyString | null };
        if (existing) {
          const billed =
            existing.currency !== input.currency &&
            (await this.repository.listInstallments(project.id)).some(
              (item) => item.billingPlanId === existing.id && item.locked,
            );
          if (billed) {
            throw new IntegrityLockedError({ message: BILLING_ERRORS.currencyLocked });
          }
          const sameContract =
            existing.contractAmount === null || contract === null
              ? existing.contractAmount === contract
              : compareMoney(existing.contractAmount, contract) === 0;
          snapshot =
            sameContract && existing.currency === input.currency
              ? { contractedUsd: existing.contractedUsd, usdRate: existing.usdRate }
              : await this.snapshotFor(today, input.currency, contract);
        } else {
          snapshot = await this.snapshotFor(today, input.currency, contract);
        }

        const plan = await this.repository.savePlan(
          {
            id: existing?.id ?? this.ids.next(),
            projectId: project.id,
            model: input.model,
            currency: input.currency,
            contractAmount: contract,
            notes: input.notes ?? null,
            ...snapshot,
          },
          now,
        );
        return {
          value: await loadPage(this.repository, project.id),
          changed: true,
          activity: [
            {
              action: existing ? 'UPDATE' : 'CREATE',
              entityType: 'BILLING_PLAN',
              entityId: plan.id,
              entityLabel: project.code,
              metadata: { projectId: project.id, model: plan.model, currency: plan.currency },
            },
          ],
        };
      },
    );
  }

  private validate(input: UpsertBillingPlanInput): void {
    const errors = new FieldCollector();
    if (!(BILLING_MODEL_VALUES as readonly unknown[]).includes(input.model)) {
      errors.add('model', BILLING_MESSAGES.required);
    }
    const currency = currencyShapeError(input.currency);
    if (currency !== null) errors.add('currency', currency);
    const contract = input.contractAmount;
    if (contract !== undefined && contract !== null) {
      const amount = positiveAmountError(contract);
      if (amount !== null) errors.add('contractAmount', amount);
    } else if (input.model !== 'RECURRENTE') {
      errors.add('contractAmount', BILLING_MESSAGES.contractAmountRequired);
    }
    if (input.notes !== undefined && input.notes !== null) {
      const notes = notesError(input.notes);
      if (notes !== null) errors.add('notes', notes);
    }
    errors.throwIfAny();
  }

  /** Snapshot of the contract in USD at the rate of `today` (D1). A non-USD contract needs a rate. */
  private async snapshotFor(
    today: string,
    currency: string,
    contract: MoneyString | null,
  ): Promise<{ contractedUsd: MoneyString | null; usdRate: MoneyString | null }> {
    const rate = await usdRateOn(this.rates, today, currency);
    if (contract === null) return { contractedUsd: null, usdRate: rate };
    if (rate === null) throw invalid('currency', BILLING_ERRORS.rateMissing);
    return { contractedUsd: toUsd(contract, rate), usdRate: rate };
  }
}
