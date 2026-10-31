import { actorOf } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import type { ActivityLogPort } from '../../../../../shared/application/ports/activity-log.port';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import type { IdGeneratorPort } from '../../../../../shared/application/ports/id-generator.port';
import type { SearchIndexPort } from '../../../../../shared/application/ports/search-index.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import { todayInCaracas, type DateOnly } from '../../../../../shared/domain/business-date';
import { ValidationFailedError, type FieldErrors } from '../../../../../shared/domain/domain-error';
import type { AccountType } from '../../../../../shared/domain/enums';
import { roundMoney, type MoneyString } from '../../../../../shared/domain/money';
import type { FinanceProjector } from '../../finance-projector';
import type { AccountRepository } from '../../ports/account.repository.port';
import type { CurrencyCatalogPort } from '../../ports/currency-catalog.port';
import type { ExchangeRatePort } from '../../ports/exchange-rate.port';
import {
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

export interface CreateAccountInput {
  readonly name: string;
  readonly type: AccountType;
  readonly institution?: string | null;
  readonly currency: string;
  readonly identifierMasked?: string | null;
  readonly holderName?: string | null;
  readonly openingBalance?: MoneyString;
  readonly openingDate: DateOnly;
  readonly active?: boolean;
  readonly notes?: string | null;
}

/**
 * Opens a company account (PRD §8.7, §12 `accounts`): `can(create, account)` → validate (name, type,
 * currency in the catalog, opening balance, identifier masked here, C5) → one `Serializable` unit of work
 * that inserts the account, caches its balance through the projector, indexes it and logs.
 */
export class CreateAccount {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly accounts: AccountRepository,
    private readonly projector: FinanceProjector,
    private readonly searchIndex: SearchIndexPort,
    private readonly activityLog: ActivityLogPort,
    private readonly clock: ClockPort,
    private readonly ids: IdGeneratorPort,
    private readonly currencies: CurrencyCatalogPort,
    private readonly rates: ExchangeRatePort,
  ) {}

  async execute(actor: CurrentUser, input: CreateAccountInput): Promise<AccountOutput> {
    assertCan(this.authorization, actor, 'create', 'account');
    const openingBalance = input.openingBalance ?? '0';
    const errors: FieldErrors = {};
    addErrors(errors, 'name', requiredTextErrors(input.name, 80));
    addErrors(errors, 'type', accountTypeErrors(input.type));
    addErrors(errors, 'currency', currencyShapeErrors(input.currency));
    addErrors(errors, 'institution', optionalTextErrors(input.institution, 80));
    addErrors(errors, 'holderName', optionalTextErrors(input.holderName, 120));
    addErrors(errors, 'notes', optionalTextErrors(input.notes, 1000));
    addErrors(errors, 'openingBalance', amountErrors(openingBalance, 'any'));
    addErrors(errors, 'openingDate', dateErrors(input.openingDate));
    if (Object.keys(errors).length > 0) throw new ValidationFailedError({ fieldErrors: errors });

    const id = this.ids.next();
    const now = this.clock.now();
    const created = await this.uow.run(
      async () => {
        const known = await this.currencies.knownCodes([input.currency]);
        if (!known.has(input.currency)) {
          throw new ValidationFailedError({
            fieldErrors: { currency: [ACCOUNT_MESSAGES.unknownCurrency] },
          });
        }
        await this.accounts.insert({
          id,
          name: input.name.trim(),
          type: input.type,
          institution: textOrNull(input.institution),
          currency: input.currency,
          identifierMasked: identifierToStore(input.identifierMasked) ?? null,
          holderName: textOrNull(input.holderName),
          openingBalance: roundMoney(openingBalance),
          openingDate: input.openingDate,
          active: input.active ?? true,
          notes: textOrNull(input.notes),
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        });
        await this.projector.projectAccount(id);
        const account = await this.accounts.find(id);
        if (!account) throw new Error('the account just inserted is missing');
        await this.searchIndex.upsert(accountSearchEntry(account));
        await this.activityLog.record({
          actor: actorOf(actor),
          action: 'CREATE',
          entityType: 'ACCOUNT',
          entityId: id,
          entityLabel: account.name,
        });
        return account;
      },
      { isolation: 'Serializable' },
    );
    return new AccountValuation(this.rates).output(created, todayInCaracas(now));
  }
}
