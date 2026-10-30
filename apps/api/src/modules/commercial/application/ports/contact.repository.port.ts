import type { ListQuery } from '../../../../shared/domain/list-query';
import type { Paginated } from '../../../../shared/domain/pagination';
import type { ContactRecord } from '../../domain/contact';

export const CONTACT_REPOSITORY = Symbol('CONTACT_REPOSITORY');

/**
 * `Contact` rows. Reads and writes run in the caller's unit of work when one is open; writes need one.
 * `findById` returns archived contacts too. A write that violates the `contact_one_primary` partial unique
 * (two live primaries for one client) throws `ConflictError`.
 */
export interface ContactRepository {
  findById(id: string): Promise<ContactRecord | null>;
  /** The client's live contacts, in no particular order. */
  findLiveByClient(clientId: string): Promise<ContactRecord[]>;
  /** The client's contacts archived at exactly `deletedAt` (the ones its cascade took). */
  findArchivedAt(clientId: string, deletedAt: Date): Promise<ContactRecord[]>;
  /** The client's live primary contacts other than `exceptId`. */
  findOtherPrimaries(clientId: string, exceptId: string | null): Promise<ContactRecord[]>;
  insert(record: ContactRecord): Promise<void>;
  /** Replaces the form values and `updatedAt` of the row `record.id`. */
  update(record: ContactRecord): Promise<void>;
  /** Soft delete of one contact: sets `deletedAt = at` and releases the primary flag. */
  archive(id: string, at: Date): Promise<void>;
  /**
   * Cascade of a client archive: sets the same `deletedAt = at` on every live contact of the client and
   * returns them as they were (primary flag included).
   */
  archiveLiveOfClient(clientId: string, at: Date): Promise<ContactRecord[]>;
  /** Clears `deletedAt` of the contacts and sets `updatedAt`. */
  restoreMany(ids: readonly string[], at: Date): Promise<void>;
  /** The contacts of one client: `q` over name, position, e-mail and phone, sort, paging, `archived`. */
  list(clientId: string, query: ListQuery): Promise<Paginated<ContactRecord>>;
  /** Live contacts of live clients matching `q`, optionally of one client; primary first, then by name. */
  search(
    q: string | undefined,
    clientId: string | undefined,
    limit: number,
  ): Promise<ContactRecord[]>;
}
