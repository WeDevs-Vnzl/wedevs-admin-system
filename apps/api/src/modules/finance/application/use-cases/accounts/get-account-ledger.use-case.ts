import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import {
  NotFoundError,
  ValidationFailedError,
  type FieldErrors,
} from '../../../../../shared/domain/domain-error';
import type { ListQuery } from '../../../../../shared/domain/list-query';
import type { Paginated } from '../../../../../shared/domain/pagination';
import {
  LEDGER_ENTRY_KIND_VALUES,
  type AccountRepository,
  type LedgerEntryKind,
  type LedgerRow,
} from '../../ports/account.repository.port';
import {
  ACCOUNT_MESSAGES,
  DEFAULT_LEDGER_SORT,
  LEDGER_SORT_FIELDS,
  addErrors,
  dateErrors,
} from './account-support';

/**
 * The ledger of an account (HU-15 CA2, §9.7, DT-105/106): every entry that changes the balance with the
 * running balance after it, read through `account_ledger_v`. Filters (kind, date range, text) narrow the
 * rows and never the balance they show.
 */
export class GetAccountLedger {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly accounts: AccountRepository,
  ) {}

  async execute(
    actor: CurrentUser,
    accountId: string,
    query: ListQuery,
  ): Promise<Paginated<LedgerRow>> {
    assertCan(this.authorization, actor, 'read', 'account');
    const errors: FieldErrors = {};
    const sort = query.sort ?? DEFAULT_LEDGER_SORT;
    if (!(LEDGER_SORT_FIELDS as readonly string[]).includes(sort.field)) {
      addErrors(errors, 'sort', [ACCOUNT_MESSAGES.invalidSort]);
    }
    const rawKinds = query.filters.kind;
    const kinds =
      rawKinds === undefined
        ? undefined
        : typeof rawKinds === 'string'
          ? [rawKinds]
          : [...rawKinds];
    if (kinds?.some((kind) => !(LEDGER_ENTRY_KIND_VALUES as readonly string[]).includes(kind))) {
      addErrors(errors, 'kind', [ACCOUNT_MESSAGES.invalidType]);
    }
    const dateFrom = single(query.filters.dateFrom);
    const dateTo = single(query.filters.dateTo);
    if (dateFrom !== undefined) addErrors(errors, 'dateFrom', dateErrors(dateFrom));
    if (dateTo !== undefined) addErrors(errors, 'dateTo', dateErrors(dateTo));
    if (Object.keys(errors).length > 0) throw new ValidationFailedError({ fieldErrors: errors });

    if (!(await this.accounts.find(accountId))) throw new NotFoundError();
    return this.accounts.ledger({
      accountId,
      sort,
      page: query.page,
      pageSize: query.pageSize,
      ...(kinds ? { kinds: kinds as LedgerEntryKind[] } : {}),
      ...(dateFrom !== undefined ? { dateFrom } : {}),
      ...(dateTo !== undefined ? { dateTo } : {}),
      ...(query.q ? { q: query.q } : {}),
    });
  }
}

function single(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : value?.[0];
}
