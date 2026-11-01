import type { CurrentUser } from '../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import { isValidDateOnly, type DateOnly } from '../../../../shared/domain/business-date';
import { ValidationFailedError, type FieldErrors } from '../../../../shared/domain/domain-error';
import type { ListFilters, ListQuery } from '../../../../shared/domain/list-query';
import type { Paginated } from '../../../../shared/domain/pagination';
import { isNoteLinkEntityType, type NoteLinkEntityType } from '../../domain/note-link';
import { caracasDayStart } from '../../../platform/application/use-cases/list-activity.use-case';
import type { NoteListCriteria, NoteRepository } from '../ports/note.repository.port';
import type { NoteListRow, NoteViews } from './note-support';

const KEY_REQUIRED = 'validation.required';
const KEY_DATE_INVALID = 'validation.date.invalid';
const KEY_OPTION_INVALID = 'validation.invalidOption';

/** The sort a request without `sort` gets from the schema; with a record filter it becomes the feed order. */
const TABLE_DEFAULT = { field: 'createdAt', direction: 'desc' } as const;

const values = (filters: ListFilters, name: string): string[] => {
  const raw = filters[name];
  return raw === undefined ? [] : Array.isArray(raw) ? [...raw] : [raw as string];
};
const single = (filters: ListFilters, name: string): string | undefined => values(filters, name)[0];

const DAY_MS = 24 * 3_600_000;

/**
 * `GET /notes`: the table (`/notes`) or the feed of one record (`entityType` + `entityId`, both or
 * neither). Filters: `authorId[]`, `tagId[]`, `linkedEntityType[]`, `pinned`, `createdFrom`/`createdTo`
 * (Caracas calendar days) and `q` over title and plain text. The feed, unless a sort other than the
 * default was asked, shows pinned notes first, then the newest. Archived notes are listed only for the
 * trash roles (`can(restore, trash)`); for anyone else `archived` is treated as `exclude` (C19).
 */
export class ListNotes {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly notes: NoteRepository,
    private readonly views: NoteViews,
  ) {}

  async execute(actor: CurrentUser, query: ListQuery): Promise<Paginated<NoteListRow>> {
    assertCan(this.authorization, actor, 'read', 'note');

    const criteria = this.criteria(query);
    const page = await this.notes.list({
      ...criteria,
      query: {
        ...query,
        archived: this.authorization.can(actor, 'restore', 'trash') ? query.archived : 'exclude',
        sort:
          criteria.entity &&
          query.sort?.field === TABLE_DEFAULT.field &&
          query.sort.direction === TABLE_DEFAULT.direction
            ? { field: 'pinned', direction: 'desc' }
            : query.sort,
      },
    });
    return { ...page, items: await this.views.rows(page.items) };
  }

  private criteria(query: ListQuery): NoteListCriteria {
    const { filters } = query;
    const errors: FieldErrors = {};
    const bad = (field: string, key: string): void => {
      errors[field] = [key];
    };

    const linkedEntityTypes = values(filters, 'linkedEntityType').filter(
      (value): value is NoteLinkEntityType => {
        const ok = isNoteLinkEntityType(value);
        if (!ok) bad('linkedEntityType', KEY_OPTION_INVALID);
        return ok;
      },
    );

    const entityType = single(filters, 'entityType');
    const entityId = single(filters, 'entityId');
    let entity: NoteListCriteria['entity'] = null;
    if (entityType !== undefined && !isNoteLinkEntityType(entityType)) {
      bad('entityType', KEY_OPTION_INVALID);
    } else if ((entityType === undefined) !== (entityId === undefined)) {
      bad(entityId === undefined ? 'entityId' : 'entityType', KEY_REQUIRED);
    } else if (entityType !== undefined && entityId !== undefined) {
      entity = { entityType: entityType as NoteLinkEntityType, entityId };
    }

    const pinnedRaw = single(filters, 'pinned');
    if (pinnedRaw !== undefined && pinnedRaw !== 'true' && pinnedRaw !== 'false') {
      bad('pinned', KEY_OPTION_INVALID);
    }

    const day = (name: string): DateOnly | undefined => {
      const value = single(filters, name);
      if (value !== undefined && !isValidDateOnly(value)) bad(name, KEY_DATE_INVALID);
      return value;
    };
    const from = day('createdFrom');
    const to = day('createdTo');

    if (Object.keys(errors).length > 0) throw new ValidationFailedError({ fieldErrors: errors });

    return {
      query,
      authorIds: values(filters, 'authorId'),
      tagIds: values(filters, 'tagId'),
      linkedEntityTypes,
      entity,
      pinned: pinnedRaw === undefined ? null : pinnedRaw === 'true',
      createdFrom: from ? caracasDayStart(from) : null,
      createdBefore: to ? new Date(caracasDayStart(to).getTime() + DAY_MS) : null,
    };
  }
}
