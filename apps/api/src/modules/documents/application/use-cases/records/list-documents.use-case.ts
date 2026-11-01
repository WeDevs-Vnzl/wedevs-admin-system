import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import {
  addDays,
  isValidDateOnly,
  todayInCaracas,
  type DateOnly,
} from '../../../../../shared/domain/business-date';
import {
  NotFoundError,
  ValidationFailedError,
  type FieldErrors,
} from '../../../../../shared/domain/domain-error';
import {
  DOCUMENT_FORMAT_VALUES,
  DOCUMENT_STATUS_VALUES,
  type DocumentFormat,
  type DocumentStatus,
} from '../../../../../shared/domain/enums';
import type { ListFilters, ListQuery } from '../../../../../shared/domain/list-query';
import type { Paginated } from '../../../../../shared/domain/pagination';
import {
  DOCUMENT_LINK_RESOURCE,
  type DocumentDetail,
  type DocumentListRow,
  type DocumentSupport,
  type DocumentViews,
} from '../../document-support';
import type {
  DocumentLinkEntityType,
  DocumentListCriteria,
  DocumentRepository,
} from '../../ports/document.repository.port';

const KEY_OPTION_INVALID = 'validation.invalidOption';
const KEY_DATE_INVALID = 'validation.date.invalid';
const STALE_DRAFT_DAYS = 14;
const DAY_MS = 86_400_000;

const values = (filters: ListFilters, name: string): string[] => {
  const raw = filters[name];
  return raw === undefined ? [] : Array.isArray(raw) ? [...raw] : [raw as string];
};
const single = (filters: ListFilters, name: string): string | undefined => values(filters, name)[0];

/** Link facets and the matrix resource that must grant `read` to filter by them (DT-142). */
const LINK_FACETS: readonly (readonly [
  facet: string,
  type: DocumentLinkEntityType,
  key: keyof Pick<
    DocumentListCriteria,
    'clientIds' | 'contactIds' | 'projectIds' | 'invoiceIds' | 'paymentIds' | 'expenseIds'
  >,
])[] = [
  ['clientId', 'CLIENT', 'clientIds'],
  ['contactId', 'CONTACT', 'contactIds'],
  ['projectId', 'PROJECT', 'projectIds'],
  ['invoiceId', 'INVOICE', 'invoiceIds'],
  ['paymentId', 'PAYMENT', 'paymentIds'],
  ['expenseId', 'EXPENSE', 'expenseIds'],
];

/**
 * Builds the repository criteria of a list or a facet count: validates every facet value (`VALIDATION` on the
 * facet), refuses to filter by a record type the caller cannot read (`NOT_FOUND`, DT-142) and shows archived
 * documents to the trash roles only (C19).
 */
function buildCriteria(
  authorization: AuthorizationPort,
  actor: CurrentUser,
  clock: ClockPort,
  query: ListQuery,
): DocumentListCriteria {
  const { filters } = query;
  const errors: FieldErrors = {};
  const bad = (field: string, key: string): void => {
    errors[field] = [key];
  };

  const enumValues = <T extends string>(name: string, allowed: readonly T[]): T[] =>
    values(filters, name).filter((value): value is T => {
      const ok = (allowed as readonly string[]).includes(value);
      if (!ok) bad(name, KEY_OPTION_INVALID);
      return ok;
    });
  const statuses = enumValues<DocumentStatus>('status', DOCUMENT_STATUS_VALUES);
  const formats = enumValues<DocumentFormat>('format', DOCUMENT_FORMAT_VALUES);

  const day = (name: string): DateOnly | null => {
    const value = single(filters, name);
    if (value === undefined) return null;
    if (!isValidDateOnly(value)) bad(name, KEY_DATE_INVALID);
    return value;
  };
  const expiresFrom = day('expiresFrom');
  const expiresTo = day('expiresTo');

  const flag = (name: string): boolean | null => {
    const raw = single(filters, name);
    if (raw === undefined) return null;
    if (raw !== 'true' && raw !== 'false') {
      bad(name, KEY_OPTION_INVALID);
      return null;
    }
    return raw === 'true';
  };
  const shared = flag('shared');
  const staleDraft = flag('staleDraft');

  const withinRaw = single(filters, 'expiringWithinDays');
  let within: number | null = null;
  if (withinRaw !== undefined) {
    within = Number(withinRaw);
    if (!Number.isInteger(within) || within < 1 || within > 365) {
      bad('expiringWithinDays', KEY_OPTION_INVALID);
      within = null;
    }
  }
  if (Object.keys(errors).length > 0) throw new ValidationFailedError({ fieldErrors: errors });

  const now = clock.now();
  const today = todayInCaracas(now);
  const links: Record<string, string[]> = {};
  for (const [facet, type, key] of LINK_FACETS) {
    const ids = values(filters, facet);
    if (ids.length > 0 && !authorization.can(actor, 'read', DOCUMENT_LINK_RESOURCE[type])) {
      throw new NotFoundError();
    }
    links[key] = ids;
  }

  return {
    query: {
      ...query,
      archived: authorization.can(actor, 'restore', 'trash') ? query.archived : 'exclude',
    },
    statuses,
    categoryIds: values(filters, 'categoryId'),
    typeIds: values(filters, 'typeId'),
    formats,
    clientIds: links.clientIds ?? [],
    contactIds: links.contactIds ?? [],
    projectIds: links.projectIds ?? [],
    invoiceIds: links.invoiceIds ?? [],
    paymentIds: links.paymentIds ?? [],
    expenseIds: links.expenseIds ?? [],
    tagIds: values(filters, 'tagId'),
    expiresFrom,
    expiresTo,
    expiring: within === null ? null : { from: today, to: addDays(today, within) },
    staleBefore: staleDraft ? new Date(now.getTime() - STALE_DRAFT_DAYS * DAY_MS) : null,
    shared,
    today,
  };
}

/**
 * `GET /documents` (HU-20). Filters: `status[]`, `categoryId[]`, `typeId[]`, `format[]` (of the current
 * version), `clientId[]`, `contactId[]`, `projectId[]`, `invoiceId[]`, `paymentId[]`, `expenseId[]`, `tagId[]`,
 * `expiresFrom`/`expiresTo`, `expiringWithinDays` (today to today + N, not `VENCIDO`/`ANULADO`), `staleDraft`
 * (`BORRADOR` untouched for more than 14 days) and `shared` (in a live share link); `q` goes through
 * `SearchEntry` (DT-141). Chips of records the caller cannot read are left out (DT-142).
 */
export class ListDocuments {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly documents: DocumentRepository,
    private readonly views: DocumentViews,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: CurrentUser, query: ListQuery): Promise<Paginated<DocumentListRow>> {
    assertCan(this.authorization, actor, 'read', 'document');
    const page = await this.documents.list(
      buildCriteria(this.authorization, actor, this.clock, query),
    );
    return { ...page, items: await this.views.rows(actor, page.items) };
  }
}

/**
 * `GET /documents/category-counts`: live documents per category id under every facet of the list except
 * `categoryId` and the page window, `q` included. Categories with no document are absent.
 */
export class CountDocumentsByCategory {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly documents: DocumentRepository,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: CurrentUser, query: ListQuery): Promise<Record<string, number>> {
    assertCan(this.authorization, actor, 'read', 'document');
    return this.documents.countByCategory(
      buildCriteria(this.authorization, actor, this.clock, query),
    );
  }
}

/**
 * `GET /documents/{id}`. An archived document is readable by id only for the trash roles (C19); for anyone
 * else it does not exist (C14).
 */
export class GetDocument {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly support: DocumentSupport,
    private readonly views: DocumentViews,
  ) {}

  async execute(actor: CurrentUser, input: { readonly id: string }): Promise<DocumentDetail> {
    assertCan(this.authorization, actor, 'read', 'document');
    const doc = await this.support.documents.findById(input.id);
    if (!doc) throw new NotFoundError();
    if (doc.deletedAt && !this.authorization.can(actor, 'restore', 'trash')) {
      throw new NotFoundError();
    }
    return this.views.detail(actor, doc);
  }
}
