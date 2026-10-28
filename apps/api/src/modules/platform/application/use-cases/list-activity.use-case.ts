import type { CurrentUser } from '../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import {
  addDays,
  isValidDateOnly,
  parseDateOnly,
  type DateOnly,
} from '../../../../shared/domain/business-date';
import {
  ACTIVITY_ACTION_VALUES,
  ACTOR_TYPE_VALUES,
  ENTITY_TYPE_VALUES,
  type ActivityAction,
  type ActorType,
  type EntityType,
} from '../../../../shared/domain/enums';
import { ValidationFailedError, type FieldErrors } from '../../../../shared/domain/domain-error';
import type { ListFilters, ListQuery } from '../../../../shared/domain/list-query';
import type { Paginated } from '../../../../shared/domain/pagination';
import { maskIp } from '../../domain/ip-mask';
import type {
  ActivityChanges,
  ActivityListCriteria,
  ActivityMetadata,
  ActivityReadPort,
  ActivityRecord,
  ActivitySortField,
} from '../ports/activity-read.port';

const SORT_FIELDS: readonly ActivitySortField[] = ['createdAt', 'action', 'entityType'];

// i18n keys, reused verbatim from the FE validators (the BE never returns translated text).
const KEY_REQUIRED = 'validation.required';
const KEY_DATE_INVALID = 'validation.date.invalid';
const KEY_SORT_INVALID = 'validation.sort.invalid';
const KEY_FORMAT_INVALID = 'validation.invalidFormat';
const KEY_OPTION_INVALID = 'validation.invalidOption';

/** Caracas has been UTC-4 without daylight saving since 2016, so its midnight is 04:00 UTC. */
const CARACAS_MIDNIGHT_UTC_MS = 4 * 3_600_000;

/**
 * The instant at which a Caracas calendar day starts (inclusive). The offset is fixed because
 * `BUSINESS_TIME_ZONE` observes no daylight saving; the unit test proves the boundary with `Intl`.
 */
export function caracasDayStart(day: DateOnly): Date {
  return new Date(parseDateOnly(day).getTime() + CARACAS_MIDNIGHT_UTC_MS);
}

/** One activity row as the use case returns it: the IP is already masked, the actor is joined. */
export interface ActivityRowOutput {
  id: string;
  actor: { type: ActorType; id: string | null; name: string | null; imageUrl: string | null };
  action: ActivityAction;
  entityType: EntityType;
  entityId: string;
  entityLabel: string;
  changes: ActivityChanges | null;
  metadata: ActivityMetadata | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
}

/** `GET /activity` (PRD §8.14, HU-29 CA1–CA2): read only, `can(read, activity)` (Owner and Admin). */
export class ListActivity {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly activity: ActivityReadPort,
  ) {}

  async execute(actor: CurrentUser, query: ListQuery): Promise<Paginated<ActivityRowOutput>> {
    assertCan(this.authorization, actor, 'read', 'activity');
    const criteria = toActivityCriteria(query);
    const page = await this.activity.list(criteria);
    return { ...page, items: page.items.map(toActivityRow) };
  }
}

/** The only place the client address leaves the BE in masked form (DT-114). */
function toActivityRow(record: ActivityRecord): ActivityRowOutput {
  return {
    id: record.id,
    actor: {
      type: record.actorType,
      id: record.actorId,
      name: record.actorName,
      imageUrl: record.actorImageUrl,
    },
    action: record.action,
    entityType: record.entityType,
    entityId: record.entityId,
    entityLabel: record.entityLabel,
    changes: record.changes,
    metadata: record.metadata,
    ip: maskIp(record.ip),
    userAgent: record.userAgent,
    createdAt: record.createdAt,
  };
}

/** Every value of a repeatable filter (`?x=a&x=b`); none when the filter is absent. */
function valuesOf(filters: ListFilters, name: string): string[] {
  const raw = filters[name];
  if (raw === undefined) return [];
  return Array.isArray(raw) ? [...raw] : [raw as string];
}

/** The value of a single-value filter; a repeated key is a format error. */
function singleOf(filters: ListFilters, name: string, errors: FieldErrors): string | null {
  const raw = filters[name];
  if (raw === undefined) return null;
  if (Array.isArray(raw)) {
    errors[name] = [KEY_FORMAT_INVALID];
    return null;
  }
  return raw as string;
}

/** Keeps the values that belong to `allowed`; any other value is an option error on `name`. */
function optionsOf<T extends string>(
  allowed: readonly T[],
  values: readonly string[],
  name: string,
  errors: FieldErrors,
): T[] {
  const known = values.filter((value): value is T =>
    (allowed as readonly string[]).includes(value),
  );
  if (known.length !== values.length) errors[name] = [KEY_OPTION_INVALID];
  return known;
}

/**
 * Validates the list query and turns it into the port criteria. `from` and `to` are Caracas calendar
 * days, both inclusive: `createdFrom` is the start of `from`, `createdBefore` the start of the day
 * after `to`. Every problem is reported at once, as `VALIDATION` with `fieldErrors`.
 */
export function toActivityCriteria(query: ListQuery): ActivityListCriteria {
  const errors: FieldErrors = {};
  const filters = query.filters;

  const sortField = query.sort?.field ?? 'createdAt';
  if (!(SORT_FIELDS as readonly string[]).includes(sortField)) errors.sort = [KEY_SORT_INVALID];

  const actorTypes = optionsOf(
    ACTOR_TYPE_VALUES,
    valuesOf(filters, 'actorType'),
    'actorType',
    errors,
  );
  const actions = optionsOf(ACTIVITY_ACTION_VALUES, valuesOf(filters, 'action'), 'action', errors);
  const entityTypes = optionsOf(
    ENTITY_TYPE_VALUES,
    valuesOf(filters, 'entityType'),
    'entityType',
    errors,
  );
  const actorIds = valuesOf(filters, 'actorId');

  const entityId = singleOf(filters, 'entityId', errors);
  // A record's timeline names exactly one entity type with its id (PRD §8.14).
  if (entityId !== null && entityTypes.length !== 1 && !errors.entityType) {
    errors.entityType = [KEY_REQUIRED];
  }

  const from = singleOf(filters, 'from', errors);
  const to = singleOf(filters, 'to', errors);
  if (from !== null && !isValidDateOnly(from)) errors.from = [KEY_DATE_INVALID];
  if (to !== null && !isValidDateOnly(to)) errors.to = [KEY_DATE_INVALID];
  if (from !== null && to !== null && !errors.from && !errors.to && from > to) {
    errors.to = [KEY_DATE_INVALID];
  }

  if (Object.keys(errors).length > 0) throw new ValidationFailedError({ fieldErrors: errors });

  return {
    page: query.page,
    pageSize: query.pageSize,
    sort: {
      field: sortField as ActivitySortField,
      direction: query.sort?.direction ?? 'desc',
    },
    search: query.q ?? null,
    actorIds,
    actorTypes,
    actions,
    entityTypes,
    entityId,
    createdFrom: from !== null ? caracasDayStart(from) : null,
    createdBefore: to !== null ? caracasDayStart(addDays(to, 1)) : null,
  };
}
