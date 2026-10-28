import type {
  ActivityListCriteria,
  ActivityReadPort,
  ActivityRecord,
} from '../../../src/modules/platform/application/ports/activity-read.port';
import { foldText } from '../../../src/shared/domain/list-query';
import type { Paginated } from '../../../src/shared/domain/pagination';

/**
 * In-memory stand-in for `PrismaActivityReadAdapter`: the same filter, search, sort and page semantics
 * over seeded rows. The SQL itself is proven by the int test against the local Postgres.
 */
export class InMemoryActivityRead implements ActivityReadPort {
  readonly rows: ActivityRecord[] = [];
  lastCriteria: ActivityListCriteria | null = null;
  calls = 0;

  async list(criteria: ActivityListCriteria): Promise<Paginated<ActivityRecord>> {
    this.calls += 1;
    this.lastCriteria = criteria;
    const matched = this.rows.filter((row) => matches(row, criteria));
    const sorted = [...matched].sort((a, b) => compare(a, b, criteria));
    const start = (criteria.page - 1) * criteria.pageSize;
    return {
      items: sorted.slice(start, start + criteria.pageSize),
      total: matched.length,
      page: criteria.page,
      pageSize: criteria.pageSize,
      pageCount: Math.max(1, Math.ceil(matched.length / criteria.pageSize)),
    };
  }
}

function matches(row: ActivityRecord, c: ActivityListCriteria): boolean {
  if (c.actorIds.length > 0 && !c.actorIds.includes(row.actorId ?? '')) return false;
  if (c.actorTypes.length > 0 && !c.actorTypes.includes(row.actorType)) return false;
  if (c.actions.length > 0 && !c.actions.includes(row.action)) return false;
  if (c.entityTypes.length > 0 && !c.entityTypes.includes(row.entityType)) return false;
  if (c.entityId !== null && row.entityId !== c.entityId) return false;
  if (c.createdFrom && row.createdAt < c.createdFrom) return false;
  if (c.createdBefore && row.createdAt >= c.createdBefore) return false;
  if (c.search) {
    const needle = foldText(c.search);
    const haystack = [row.entityLabel, row.actorName ?? ''].map(foldText);
    if (!haystack.some((text) => text.includes(needle))) return false;
  }
  return true;
}

function compare(a: ActivityRecord, b: ActivityRecord, c: ActivityListCriteria): number {
  const direction = c.sort.direction === 'desc' ? -1 : 1;
  const key = (row: ActivityRecord): string | number =>
    c.sort.field === 'createdAt'
      ? row.createdAt.getTime()
      : c.sort.field === 'action'
        ? row.action
        : row.entityType;
  const ka = key(a);
  const kb = key(b);
  if (ka !== kb) return (ka < kb ? -1 : 1) * direction;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
