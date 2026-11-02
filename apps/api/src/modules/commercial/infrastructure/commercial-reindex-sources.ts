import type { SearchIndexEntry } from '../../../shared/application/ports/search-index.port';
import type { SearchReindexSource } from '../../../shared/application/ports/search-reindex.port';
import type { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type { ClientRepository } from '../application/ports/client.repository.port';
import type { ContactRepository } from '../application/ports/contact.repository.port';
import type { NoteRepository } from '../application/ports/note.repository.port';
import type { ProjectRepository } from '../application/ports/project.repository.port';
import { noteSearchEntry } from '../application/use-cases/note-support';
import { projectEntryOf } from '../application/use-cases/project-sync';
import { clientSearchEntry } from '../domain/client';
import { contactSearchEntry } from '../domain/contact';

/**
 * An explicit `deletedAt` key opts out of the soft-delete default filter: a reindex walks archived rows too
 * (A11), so a restore never needs a backfill.
 */
const INCLUDING_ARCHIVED = { deletedAt: undefined } as const;

type IdPage = (afterId: string | null, take: number) => Promise<string[]>;

/** Ids of one table strictly after `afterId`, ascending; the page every source of this file shares. */
function pageOf(
  find: (args: {
    where: { id?: { gt: string }; deletedAt: undefined };
    select: { id: true };
    orderBy: { id: 'asc' };
    take: number;
  }) => Promise<{ id: string }[]>,
): IdPage {
  return async (afterId, take) =>
    (
      await find({
        where: { ...(afterId === null ? {} : { id: { gt: afterId } }), ...INCLUDING_ARCHIVED },
        select: { id: true },
        orderBy: { id: 'asc' },
        take,
      })
    ).map((row) => row.id);
}

/** `CLIENT` entries through the builder the client mutations use; archived clients included. */
export class ClientReindexSource implements SearchReindexSource {
  readonly entityType = 'CLIENT' as const;

  constructor(
    private readonly host: TransactionHost,
    private readonly clients: Pick<ClientRepository, 'findById'>,
  ) {}

  pageIds(afterId: string | null, take: number): Promise<string[]> {
    return pageOf((args) => this.host.db.client.findMany(args))(afterId, take);
  }

  async entryOf(id: string): Promise<SearchIndexEntry | null> {
    const record = await this.clients.findById(id);
    return record ? clientSearchEntry(record) : null;
  }
}

/** `CONTACT` entries; archived contacts included, with the flag. */
export class ContactReindexSource implements SearchReindexSource {
  readonly entityType = 'CONTACT' as const;

  constructor(
    private readonly host: TransactionHost,
    private readonly contacts: Pick<ContactRepository, 'findById'>,
  ) {}

  pageIds(afterId: string | null, take: number): Promise<string[]> {
    return pageOf((args) => this.host.db.contact.findMany(args))(afterId, take);
  }

  async entryOf(id: string): Promise<SearchIndexEntry | null> {
    const record = await this.contacts.findById(id);
    return record ? contactSearchEntry(record) : null;
  }
}

/** `PROJECT` entries through `projectEntryOf`, the builder `ProjectSync.reindex` writes with. */
export class ProjectReindexSource implements SearchReindexSource {
  readonly entityType = 'PROJECT' as const;

  constructor(
    private readonly host: TransactionHost,
    private readonly projects: Pick<
      ProjectRepository,
      'findById' | 'clientRefs' | 'clientLegalNames'
    >,
  ) {}

  pageIds(afterId: string | null, take: number): Promise<string[]> {
    return pageOf((args) => this.host.db.project.findMany(args))(afterId, take);
  }

  async entryOf(id: string): Promise<SearchIndexEntry | null> {
    const record = await this.projects.findById(id);
    return record ? projectEntryOf(this.projects, record) : null;
  }
}

/** `NOTE` entries through the builder the note mutations use; archived notes included. */
export class NoteReindexSource implements SearchReindexSource {
  readonly entityType = 'NOTE' as const;

  constructor(
    private readonly host: TransactionHost,
    private readonly notes: Pick<NoteRepository, 'findById'>,
  ) {}

  pageIds(afterId: string | null, take: number): Promise<string[]> {
    return pageOf((args) => this.host.db.note.findMany(args))(afterId, take);
  }

  async entryOf(id: string): Promise<SearchIndexEntry | null> {
    const record = await this.notes.findById(id);
    return record ? noteSearchEntry(record, record.deletedAt !== null) : null;
  }
}
