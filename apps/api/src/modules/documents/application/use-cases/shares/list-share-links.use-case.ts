import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import {
  isValidDateOnly,
  todayInCaracas,
  type DateOnly,
} from '../../../../../shared/domain/business-date';
import { ValidationFailedError, type FieldErrors } from '../../../../../shared/domain/domain-error';
import { SHARE_EVENT_VALUES, type ShareEvent } from '../../../../../shared/domain/enums';
import type { ListFilters, ListQuery } from '../../../../../shared/domain/list-query';
import type { Paginated } from '../../../../../shared/domain/pagination';
import type { ShareStatus } from '../../../domain';
import type {
  ShareAccessLogEntry,
  ShareLinkListCriteria,
  ShareLinkRepository,
} from '../../ports/share-link.repository.port';
import type { ShareLinkDetail, ShareLinkListRow, ShareSupport, ShareViews } from './share-support';

const INVALID_OPTION_KEY = 'validation.invalidOption';
const INVALID_DATE_KEY = 'validation.date.invalid';
const SHARE_STATUS_VALUES: readonly ShareStatus[] = ['ACTIVE', 'REVOKED', 'EXPIRED'];

const values = (filters: ListFilters, name: string): string[] => {
  const raw = filters[name];
  return raw === undefined ? [] : Array.isArray(raw) ? [...raw] : [raw as string];
};

/** Reads the facets of a list; a bad value is `VALIDATION` on the facet. */
class FacetReader {
  readonly errors: FieldErrors = {};

  constructor(private readonly filters: ListFilters) {}

  oneOf<T extends string>(name: string, allowed: readonly T[]): T[] {
    return values(this.filters, name).filter((value): value is T => {
      const ok = (allowed as readonly string[]).includes(value);
      if (!ok) this.errors[name] = [INVALID_OPTION_KEY];
      return ok;
    });
  }

  day(name: string): DateOnly | null {
    const value = values(this.filters, name)[0];
    if (value === undefined) return null;
    if (!isValidDateOnly(value)) this.errors[name] = [INVALID_DATE_KEY];
    return value;
  }

  flag(name: string): boolean | null {
    const value = values(this.filters, name)[0];
    if (value === undefined) return null;
    if (value !== 'true' && value !== 'false') {
      this.errors[name] = [INVALID_OPTION_KEY];
      return null;
    }
    return value === 'true';
  }

  text(name: string): string | null {
    return values(this.filters, name)[0] ?? null;
  }

  all(name: string): string[] {
    return values(this.filters, name);
  }

  assertValid(): void {
    if (Object.keys(this.errors).length > 0) {
      throw new ValidationFailedError({ fieldErrors: this.errors });
    }
  }
}

/**
 * `listShareLinks` (`GET /share-links`, the management table and a document's "Compartir" tab): Owner and Admin
 * (`share`). Facets `status` (derived from `revokedAt`, `expiresAt` and the Caracas day, choice 7), `clientId`,
 * `documentId` (links that include it), `hasAccessKeys`, `createdFrom` / `createdTo` (Caracas days, inclusive);
 * `q` searches the title and the client label. Sorted and paged in SQL.
 */
export class ListShareLinks {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly shares: ShareLinkRepository,
    private readonly views: ShareViews,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: CurrentUser, query: ListQuery): Promise<Paginated<ShareLinkListRow>> {
    assertCan(this.authorization, actor, 'read', 'share');
    const reader = new FacetReader(query.filters);
    const criteria: ShareLinkListCriteria = {
      query,
      statuses: reader.oneOf('status', SHARE_STATUS_VALUES),
      clientIds: reader.all('clientId'),
      documentId: reader.text('documentId'),
      hasAccessKeys: reader.flag('hasAccessKeys'),
      createdFrom: reader.day('createdFrom'),
      createdTo: reader.day('createdTo'),
      today: todayInCaracas(this.clock.now()),
    };
    reader.assertValid();
    const page = await this.shares.list(criteria);
    return { ...page, items: await this.views.rows(page.items) };
  }
}

/** `getShareLink` (`GET /share-links/{id}`): the link with its documents, key flags and counters. */
export class GetShareLink {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly views: ShareViews,
  ) {}

  async execute(actor: CurrentUser, input: { readonly id: string }): Promise<ShareLinkDetail> {
    assertCan(this.authorization, actor, 'read', 'share');
    return this.views.detail(input.id);
  }
}

/**
 * `listShareAccessLog` (`GET /share-links/{id}/access-log`): the access table of one link, newest first.
 * Facets `event`, `documentId`, `from` / `to` (Caracas days, inclusive). The visitor is a 12-character prefix of
 * the salted IP hash; the IP and the whole hash never leave the repository.
 */
export class ListShareAccessLog {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly support: ShareSupport,
  ) {}

  async execute(
    actor: CurrentUser,
    input: { readonly shareLinkId: string; readonly query: ListQuery },
  ): Promise<Paginated<ShareAccessLogEntry>> {
    assertCan(this.authorization, actor, 'read', 'share');
    const reader = new FacetReader(input.query.filters);
    const events: ShareEvent[] = reader.oneOf('event', SHARE_EVENT_VALUES);
    const documentId = reader.text('documentId');
    const from = reader.day('from');
    const to = reader.day('to');
    reader.assertValid();
    await this.support.requireLink(input.shareLinkId);
    return this.support.shares.listAccessLog({
      shareLinkId: input.shareLinkId,
      query: input.query,
      events,
      documentId,
      from,
      to,
    });
  }
}
