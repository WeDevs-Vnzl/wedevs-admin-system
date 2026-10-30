import type { DateOnly } from '../../../../shared/domain/business-date';
import type { ClientKind, ClientStatus } from '../../../../shared/domain/enums';
import type { ArchivedMode, SortSpec } from '../../../../shared/domain/list-query';
import type { Paginated } from '../../../../shared/domain/pagination';
import type { ClientRecord } from '../../domain/client';

export const CLIENT_REPOSITORY = Symbol('CLIENT_REPOSITORY');

/** The list query as the repository sees it: filters already parsed and the money gates already applied. */
export interface ClientListQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly sort: SortSpec;
  /** Accent- and case-insensitive match over trade name, legal name, code, tax id and e-mail. */
  readonly q?: string;
  readonly archived: ArchivedMode;
  readonly status?: readonly ClientStatus[];
  readonly kind?: readonly ClientKind[];
  readonly country?: readonly string[];
  /** A client matches when it carries any of these tags. */
  readonly tagIds?: readonly string[];
  /** Caracas calendar days of `createdAt`, inclusive. */
  readonly createdFrom?: DateOnly;
  readonly createdTo?: DateOnly;
  /** `ClientMetrics.overdueUsd > 0` when true, `= 0` (or no row) when false. */
  readonly hasOverdue?: boolean;
}

/** A client with the columns of its `ClientMetrics` row (`0`/`null`/`"0.00"` when the row is absent). */
export interface ClientListEntry {
  readonly client: ClientRecord;
  readonly projectCount: number;
  readonly lastActivityAt: Date | null;
  readonly totalInvoicedUsd: string;
  readonly receivableUsd: string;
}

/**
 * `Client` rows. Reads and writes run in the caller's unit of work when one is open; writes need one.
 * `findById` returns archived clients too (the caller checks `deletedAt`). Writes translate a unique
 * violation on the (tax id, country) index to `ConflictError`.
 */
export interface ClientRepository {
  findById(id: string): Promise<ClientRecord | null>;
  /**
   * The live client that already holds this (tax id, country), comparing the normalized key (no case,
   * spaces, dots or dashes), other than `exceptId`.
   */
  findTaxIdHolder(taxId: string, country: string, exceptId?: string): Promise<ClientRecord | null>;
  /** Whether a live project of the client is `PROPUESTA|EN_CURSO|PAUSADO|MANTENIMIENTO` (own query over `ProjectClient`/`Project`). */
  hasActiveProjects(clientId: string): Promise<boolean>;
  insert(record: ClientRecord): Promise<void>;
  /** Replaces the form values, `status`, `activatedAt` and `updatedAt` of the row `record.id`. */
  update(record: ClientRecord): Promise<void>;
  /** Soft delete: sets `deletedAt = at`, `deletedById` and `updatedAt`. */
  archive(id: string, at: Date, byUserId: string): Promise<void>;
  /** Clears `deletedAt` and `deletedById`, sets `updatedAt`. */
  restore(id: string, at: Date): Promise<void>;
  list(query: ClientListQuery): Promise<Paginated<ClientListEntry>>;
  /** Live clients matching `q` (all when blank), by trade name, at most `limit`. */
  search(q: string | undefined, limit: number): Promise<ClientRecord[]>;
}
