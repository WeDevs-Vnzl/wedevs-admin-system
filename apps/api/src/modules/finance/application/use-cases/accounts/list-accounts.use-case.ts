import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import { todayInCaracas } from '../../../../../shared/domain/business-date';
import { ValidationFailedError, type FieldErrors } from '../../../../../shared/domain/domain-error';
import { ACCOUNT_TYPE_VALUES, type AccountType } from '../../../../../shared/domain/enums';
import type { ListQuery } from '../../../../../shared/domain/list-query';
import type { Paginated } from '../../../../../shared/domain/pagination';
import type {
  AccountFilter,
  AccountRepository,
  AccountStatusFilter,
} from '../../ports/account.repository.port';
import type { ExchangeRatePort } from '../../ports/exchange-rate.port';
import {
  ACCOUNT_MESSAGES,
  ACCOUNT_SORT_FIELDS,
  AccountValuation,
  DEFAULT_ACCOUNT_SORT,
  addErrors,
  type AccountOutput,
} from './account-support';

const many = (value: string | readonly string[] | undefined): string[] | undefined =>
  value === undefined ? undefined : typeof value === 'string' ? [value] : [...value];

/**
 * Accounts for the list and the pickers (PRD §8.7): inactive ones are hidden unless `includeInactive` (or a
 * `status` facet, which wins) asks for them. Accounts are never archived, so `archived` is ignored. Each row
 * carries its USD value at today's rate.
 */
export class ListAccounts {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly accounts: AccountRepository,
    private readonly rates: ExchangeRatePort,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: CurrentUser, query: ListQuery): Promise<Paginated<AccountOutput>> {
    assertCan(this.authorization, actor, 'read', 'account');
    const errors: FieldErrors = {};
    const sort = query.sort ?? DEFAULT_ACCOUNT_SORT;
    if (!(ACCOUNT_SORT_FIELDS as readonly string[]).includes(sort.field)) {
      addErrors(errors, 'sort', [ACCOUNT_MESSAGES.invalidSort]);
    }
    const types = many(query.filters.type);
    if (types?.some((type) => !(ACCOUNT_TYPE_VALUES as readonly string[]).includes(type))) {
      addErrors(errors, 'type', [ACCOUNT_MESSAGES.invalidType]);
    }
    const statuses = many(query.filters.status);
    if (statuses?.some((status) => status !== 'active' && status !== 'inactive')) {
      addErrors(errors, 'status', [ACCOUNT_MESSAGES.invalidType]);
    }
    if (Object.keys(errors).length > 0) throw new ValidationFailedError({ fieldErrors: errors });

    const filter: AccountFilter = {
      page: query.page,
      pageSize: query.pageSize,
      sort,
      ...(query.q ? { q: query.q } : {}),
      ...(types ? { types: types as AccountType[] } : {}),
      ...(many(query.filters.currency)
        ? { currencies: many(query.filters.currency) as string[] }
        : {}),
      ...(statuses ? { statuses: statuses as AccountStatusFilter[] } : {}),
      includeInactive: query.filters.includeInactive === 'true',
    };
    const page = await this.accounts.list(filter);
    const valuation = new AccountValuation(this.rates);
    const today = todayInCaracas(this.clock.now());
    const items: AccountOutput[] = [];
    for (const account of page.items) items.push(await valuation.output(account, today));
    return { ...page, items };
  }
}
