import type { CurrentUser } from '../../../../../shared/application/current-user';
import type { DateOnly } from '../../../../../shared/domain/business-date';
import type { ListFilters, ListQuery, SortSpec } from '../../../../../shared/domain/list-query';
import type { Paginated } from '../../../../../shared/domain/pagination';
import {
  monthEnd,
  monthOf,
  monthsOf,
  monthStart,
  shiftMonth,
  type DateRange,
  type MonthKey,
} from '../../../domain/report-range';

/**
 * A list use case of another context (`ListClients`, `ListProjects`...), seen through the one method the
 * overviews call. The owner runs its own `can()`, money gates and chips, so a row is built once (DT-174).
 */
export interface ListSource<T> {
  execute(actor: CurrentUser, query: ListQuery): Promise<Paginated<T>>;
}

/** Rows shown in the short lists of the overviews. */
export const SHORT_LIST = 5;

/** The largest page the list contract allows. */
const SCAN_PAGE_SIZE = 100;
/** A studio has tens of clients; the guard only stops a runaway scan. */
const MAX_SCAN_PAGES = 50;

export function queryOf(
  sort: SortSpec,
  filters: ListFilters = {},
  pageSize: ListQuery['pageSize'] = 25,
): ListQuery {
  return { page: 1, pageSize, sort, archived: 'exclude', filters };
}

/**
 * The first rows of a sorted list, at most `limit`. The page size is one of the contract's three values, so
 * the page is cut here.
 */
export async function firstRows<T>(
  source: ListSource<T>,
  actor: CurrentUser,
  query: ListQuery,
  limit: number,
): Promise<T[]> {
  const page = await source.execute(actor, query);
  return page.items.slice(0, limit);
}

/**
 * The rows with the wanted ids, found by walking the owner's live list page by page. The owners offer no
 * lookup by id, and a ranked id may sit on any page.
 */
export async function rowsByIds<T>(
  source: ListSource<T>,
  actor: CurrentUser,
  sort: SortSpec,
  wanted: ReadonlySet<string>,
  idOf: (row: T) => string,
): Promise<Map<string, T>> {
  const found = new Map<string, T>();
  if (wanted.size === 0) return found;
  for (let page = 1; page <= MAX_SCAN_PAGES; page += 1) {
    const result = await source.execute(actor, { ...queryOf(sort, {}, SCAN_PAGE_SIZE), page });
    for (const row of result.items) {
      if (wanted.has(idOf(row))) found.set(idOf(row), row);
    }
    if (found.size === wanted.size || page >= result.pageCount) break;
  }
  return found;
}

/** Every row of a list, walking its pages (accounts are a handful, never archived). */
export async function allRows<T>(
  source: ListSource<T>,
  actor: CurrentUser,
  sort: SortSpec,
  filters: ListFilters = {},
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; page <= MAX_SCAN_PAGES; page += 1) {
    const result = await source.execute(actor, { ...queryOf(sort, filters, SCAN_PAGE_SIZE), page });
    rows.push(...result.items);
    if (page >= result.pageCount) break;
  }
  return rows;
}

/** The last `count` calendar months ending with the month of `today`, and the dates they span. */
export function lastMonths(
  today: DateOnly,
  count: number,
): { months: MonthKey[]; range: DateRange } {
  const last = monthOf(today);
  const first = shiftMonth(last, -(count - 1));
  const range = { from: monthStart(first), to: monthEnd(last) };
  return { months: monthsOf(range), range };
}

/** Every fact there is: breakdowns of the payments overview are not limited to a window (the mock's). */
export const ALL_TIME: DateRange = { from: '1900-01-01', to: '9999-12-31' };
