import { actorOf } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import type { ActivityLogPort } from '../../../../../shared/application/ports/activity-log.port';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import type { RowLocksPort } from '../../../../../shared/application/ports/row-locks.port';
import type { SearchIndexPort } from '../../../../../shared/application/ports/search-index.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import { diffFields } from '../../../../../shared/domain/activity-diff';
import { todayInCaracas, type DateOnly } from '../../../../../shared/domain/business-date';
import {
  NotFoundError,
  ValidationFailedError,
  type FieldErrors,
} from '../../../../../shared/domain/domain-error';
import type { AccountType } from '../../../../../shared/domain/enums';
import { roundMoney, type MoneyString } from '../../../../../shared/domain/money';
import type { FinanceProjector } from '../../finance-projector';
import type { AccountPatch, AccountRepository } from '../../ports/account.repository.port';
import type { CurrencyCatalogPort } from '../../ports/currency-catalog.port';
import type { ExchangeRatePort } from '../../ports/exchange-rate.port';
import {
  ACCOUNT_DIFF_FIELDS,
  ACCOUNT_MESSAGES,
  AccountValuation,
  accountSearchEntry,
  accountTypeErrors,
  addErrors,
  amountErrors,
  currencyShapeErrors,
  dateErrors,
  identifierToStore,
  optionalTextErrors,
  requiredTextErrors,
  textOrNull,
  type AccountOutput,
} from './account-support';

/** Every field is optional: an absent one keeps the stored value, a blank identifier keeps it too. */
export interface UpdateAccountInput {
  readonly name?: string;
  readonly type?: AccountType;
  readonly institution?: string | null;
  readonly currency?: string;
  readonly identifierMasked?: string | null;
  readonly holderName?: string | null;
  readonly openingBalance?: MoneyString;
  readonly openingDate?: DateOnly;
  readonly active?: boolean;
  readonly notes?: string | null;
}

/**
 * Edits an account (PRD §8.7): `can(update, account)` → validate → one `Serializable` unit of work that
 * locks the `Account` row first, applies the currency lock (an account with movements keeps its currency,
 * its balance is in it), rewrites the cached balance (the opening may have changed), the search entry and
 * logs the changed fields. Deactivating is allowed with movements; an account is never archived (Q-BE3-4).
 */
export class UpdateAccount {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly locks: RowLocksPort,
    private readonly accounts: AccountRepository,
    private readonly projector: FinanceProjector,
    private readonly searchIndex: SearchIndexPort,
    private readonly activityLog: ActivityLogPort,
    private readonly clock: ClockPort,
    private readonly currencies: CurrencyCatalogPort,
    private readonly rates: ExchangeRatePort,
  ) {}

  async execute(actor: CurrentUser, id: string, input: UpdateAccountInput): Promise<AccountOutput> {
    assertCan(this.authorization, actor, 'update', 'account');
    const errors: FieldErrors = {};
    if (input.name !== undefined) addErrors(errors, 'name', requiredTextErrors(input.name, 80));
    if (input.type !== undefined) addErrors(errors, 'type', accountTypeErrors(input.type));
    if (input.currency !== undefined)
      addErrors(errors, 'currency', currencyShapeErrors(input.currency));
    addErrors(errors, 'institution', optionalTextErrors(input.institution, 80));
    addErrors(errors, 'holderName', optionalTextErrors(input.holderName, 120));
    addErrors(errors, 'notes', optionalTextErrors(input.notes, 1000));
    if (input.openingBalance !== undefined) {
      addErrors(errors, 'openingBalance', amountErrors(input.openingBalance, 'any'));
    }
    if (input.openingDate !== undefined)
      addErrors(errors, 'openingDate', dateErrors(input.openingDate));
    if (Object.keys(errors).length > 0) throw new ValidationFailedError({ fieldErrors: errors });

    const now = this.clock.now();
    const updated = await this.uow.run(
      async () => {
        await this.locks.lock({ Account: [id] });
        const before = await this.accounts.find(id);
        if (!before) throw new NotFoundError();
        if (
          input.currency !== undefined &&
          input.currency !== before.currency &&
          (await this.accounts.hasMovements(id))
        ) {
          throw new ValidationFailedError({
            fieldErrors: { currency: [ACCOUNT_MESSAGES.currencyLocked] },
          });
        }
        if (input.currency !== undefined && input.currency !== before.currency) {
          const known = await this.currencies.knownCodes([input.currency]);
          if (!known.has(input.currency)) {
            throw new ValidationFailedError({
              fieldErrors: { currency: [ACCOUNT_MESSAGES.unknownCurrency] },
            });
          }
        }
        const identifier = identifierToStore(input.identifierMasked);
        const patch: AccountPatch = {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.type !== undefined ? { type: input.type } : {}),
          ...(input.institution !== undefined
            ? { institution: textOrNull(input.institution) }
            : {}),
          ...(input.currency !== undefined ? { currency: input.currency } : {}),
          ...(identifier !== undefined ? { identifierMasked: identifier } : {}),
          ...(input.holderName !== undefined ? { holderName: textOrNull(input.holderName) } : {}),
          ...(input.openingBalance !== undefined
            ? { openingBalance: roundMoney(input.openingBalance) }
            : {}),
          ...(input.openingDate !== undefined ? { openingDate: input.openingDate } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
          ...(input.notes !== undefined ? { notes: textOrNull(input.notes) } : {}),
          updatedAt: now.toISOString(),
        };
        await this.accounts.update(id, patch);
        await this.projector.projectAccount(id);
        const after = await this.accounts.find(id);
        if (!after) throw new Error('the account just updated is missing');
        await this.searchIndex.upsert(accountSearchEntry(after));
        const changes = diffFields({ ...before }, { ...after }, { fields: ACCOUNT_DIFF_FIELDS });
        if (changes) {
          await this.activityLog.record({
            actor: actorOf(actor),
            action: 'UPDATE',
            entityType: 'ACCOUNT',
            entityId: id,
            entityLabel: after.name,
            changes,
          });
        }
        return after;
      },
      { isolation: 'Serializable' },
    );
    return new AccountValuation(this.rates).output(updated, todayInCaracas(now));
  }
}
