import { must } from '../must';
import type { UserRef } from '../../../../src/modules/documents/application/ports/document.repository.port';
import type {
  NewShareLink,
  SharableDocument,
  ShareAccessLogCriteria,
  ShareAccessLogEntry,
  ShareDocumentLink,
  ShareDocumentRead,
  ShareDocumentWrite,
  ShareLinkListCriteria,
  ShareLinkPatch,
  ShareLinkRecord,
  ShareLinkRelations,
  ShareLinkRepository,
} from '../../../../src/modules/documents/application/ports/share-link.repository.port';
import { shareStatusOn, shareCountersOf } from '../../../../src/modules/documents/domain';
import { toDateOnly, type DateOnly } from '../../../../src/shared/domain/business-date';
import type { DocumentFormat, ShareEvent } from '../../../../src/shared/domain/enums';
import { foldText } from '../../../../src/shared/domain/list-query';
import { paginated, type Paginated } from '../../../../src/shared/domain/pagination';
import type {
  InMemoryUnitOfWork,
  TransactionParticipant,
} from '../../../support/fakes/in-memory-unit-of-work';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

interface StoredDocument extends Mutable<ShareDocumentLink> {
  /** The hash is kept inside the fake: the port never returns it except through `accessKeyHashOf`. */
  accessKeyHash: string | null;
}

export interface FakeLogRow {
  readonly id: string;
  readonly shareLinkId: string;
  readonly event: ShareEvent;
  readonly documentId: string | null;
  readonly ipHash: string;
  readonly userAgent: string | null;
  readonly createdAt: Date;
}

interface State {
  links: Map<string, ShareLinkRecord>;
  documents: StoredDocument[];
}

const copyState = (state: State): State => ({
  links: new Map(state.links),
  documents: state.documents.map((row) => ({ ...row })),
});

export interface InMemoryShareLinkDeps {
  userRef(id: string): UserRef;
  clientLabel(clientId: string): string | null;
}

/** `ShareLink`, its documents and the access log in memory, with the committed/pending split of the unit of work. */
export class InMemoryShareLinkRepository implements ShareLinkRepository, TransactionParticipant {
  private committed: State = { links: new Map(), documents: [] };
  private pending: State = copyState(this.committed);
  /** Number of writes, so a test can assert "nothing written". */
  writeCount = 0;
  readonly catalog = new Map<string, SharableDocument>();
  readonly versions = new Map<
    string,
    { documentId: string; versionNumber: number; format: DocumentFormat }
  >();
  readonly logs: FakeLogRow[] = [];

  constructor(
    private readonly uow: InMemoryUnitOfWork,
    private readonly deps: InMemoryShareLinkDeps,
  ) {
    uow.enlist(this);
  }

  private get state(): State {
    return this.uow.isActive ? this.pending : this.committed;
  }

  private write(what: string): State {
    this.uow.assertActive(`ShareLinkRepository.${what}`);
    this.writeCount += 1;
    return this.pending;
  }

  begin(): void {
    this.pending = copyState(this.committed);
  }
  commit(): void {
    this.committed = this.pending;
  }
  rollback(): void {
    this.pending = copyState(this.committed);
  }

  /** Committed links. */
  get rows(): ShareLinkRecord[] {
    return [...this.committed.links.values()];
  }

  /** Committed document rows of a link, with the stored hash (for assertions on what is persisted). */
  storedDocuments(shareLinkId: string): (ShareDocumentLink & { accessKeyHash: string | null })[] {
    return this.committed.documents.filter((row) => row.shareLinkId === shareLinkId);
  }

  seedLink(link: ShareLinkRecord, documents: readonly ShareDocumentWrite[] = []): void {
    this.committed.links.set(link.id, link);
    this.committed.documents.push(...documents.map((item) => this.toStored(link.id, item)));
    this.pending = copyState(this.committed);
  }

  private toStored(shareLinkId: string, item: ShareDocumentWrite): StoredDocument {
    return {
      shareLinkId,
      documentId: item.documentId,
      versionId: item.versionId,
      order: item.order,
      hasAccessKey: item.key.kind === 'set',
      accessKeyUpdatedAt: item.key.kind === 'set' ? item.key.updatedAt : null,
      accessKeyHash: item.key.kind === 'set' ? item.key.hash : null,
    };
  }

  async insert(link: NewShareLink, documents: readonly ShareDocumentWrite[]): Promise<void> {
    const state = this.write('insert');
    state.links.set(link.id, {
      ...link,
      expiredAt: null,
      revokedAt: null,
      viewCount: 0,
      downloadCount: 0,
      lastAccessedAt: null,
    });
    state.documents.push(...documents.map((item) => this.toStored(link.id, item)));
  }

  async findById(id: string): Promise<ShareLinkRecord | null> {
    return this.state.links.get(id) ?? null;
  }

  async findByToken(token: string): Promise<ShareLinkRecord | null> {
    return [...this.state.links.values()].find((link) => link.token === token) ?? null;
  }

  async documentsOf(shareLinkId: string): Promise<ShareDocumentLink[]> {
    return this.state.documents
      .filter((row) => row.shareLinkId === shareLinkId)
      .sort((a, b) => a.order - b.order)
      .map(({ accessKeyHash: _hash, ...rest }) => rest);
  }

  async accessKeyHashOf(shareLinkId: string, documentId: string): Promise<string | null> {
    return (
      this.state.documents.find(
        (row) => row.shareLinkId === shareLinkId && row.documentId === documentId,
      )?.accessKeyHash ?? null
    );
  }

  async update(id: string, patch: ShareLinkPatch): Promise<void> {
    const state = this.write('update');
    const link = state.links.get(id);
    if (!link) throw new Error(`share link ${id} not found`);
    state.links.set(id, {
      ...link,
      title: patch.title,
      message: patch.message,
      clientId: patch.clientId,
      locale: patch.locale,
      allowDownload: patch.allowDownload,
      expiresAt: patch.expiresAt,
      expiredAt: patch.clearExpiredAt ? null : link.expiredAt,
    });
  }

  async replaceDocuments(
    shareLinkId: string,
    documents: readonly ShareDocumentWrite[],
  ): Promise<void> {
    const state = this.write('replaceDocuments');
    const previous = state.documents.filter((row) => row.shareLinkId === shareLinkId);
    state.documents = state.documents.filter((row) => row.shareLinkId !== shareLinkId);
    for (const item of documents) {
      const before = previous.find((row) => row.documentId === item.documentId);
      const stored = this.toStored(shareLinkId, item);
      if (item.key.kind === 'keep' && before) {
        state.documents.push({
          ...stored,
          ...before,
          versionId: item.versionId,
          order: item.order,
        });
      } else {
        state.documents.push(stored);
      }
    }
  }

  async setKey(
    shareLinkId: string,
    documentId: string,
    key: { hash: string; updatedAt: Date } | null,
  ): Promise<void> {
    const state = this.write('setKey');
    const row = state.documents.find(
      (item) => item.shareLinkId === shareLinkId && item.documentId === documentId,
    );
    if (!row) throw new Error('document not in the link');
    row.hasAccessKey = key !== null;
    row.accessKeyHash = key?.hash ?? null;
    row.accessKeyUpdatedAt = key?.updatedAt ?? null;
  }

  async revoke(id: string, at: Date): Promise<void> {
    const state = this.write('revoke');
    const link = state.links.get(id);
    if (link) state.links.set(id, { ...link, revokedAt: at });
  }

  async markExpired(id: string, at: Date): Promise<void> {
    const state = this.write('markExpired');
    const link = state.links.get(id);
    if (link) state.links.set(id, { ...link, expiredAt: at });
  }

  async expiredIds(today: DateOnly): Promise<string[]> {
    return [...this.state.links.values()]
      .filter(
        (link) => !link.revokedAt && !link.expiredAt && link.expiresAt && link.expiresAt < today,
      )
      .map((link) => link.id)
      .sort();
  }

  async sharableDocuments(ids: readonly string[]): Promise<Map<string, SharableDocument>> {
    return new Map(
      ids.flatMap((id) => {
        const doc = this.catalog.get(id);
        return doc ? [[id, doc] as const] : [];
      }),
    );
  }

  async versionOwners(versionIds: readonly string[]): Promise<Map<string, string>> {
    return new Map(
      versionIds.flatMap((id) => {
        const version = this.versions.get(id);
        return version ? [[id, version.documentId] as const] : [];
      }),
    );
  }

  async list(criteria: ShareLinkListCriteria): Promise<Paginated<ShareLinkRecord>> {
    const { query } = criteria;
    const q = query.q ? foldText(query.q) : null;
    const rows = [...this.state.links.values()].filter((link) => {
      if (
        criteria.statuses.length &&
        !criteria.statuses.includes(shareStatusOn(link, criteria.today))
      ) {
        return false;
      }
      if (criteria.clientIds.length && !criteria.clientIds.includes(link.clientId ?? ''))
        return false;
      const docs = this.state.documents.filter((row) => row.shareLinkId === link.id);
      if (criteria.documentId && !docs.some((row) => row.documentId === criteria.documentId)) {
        return false;
      }
      if (
        criteria.hasAccessKeys !== null &&
        docs.some((row) => row.hasAccessKey) !== criteria.hasAccessKeys
      ) {
        return false;
      }
      const day = toDateOnly(link.createdAt);
      if (criteria.createdFrom && day < criteria.createdFrom) return false;
      if (criteria.createdTo && day > criteria.createdTo) return false;
      if (q) {
        const label = link.clientId ? this.deps.clientLabel(link.clientId) : null;
        return [link.title, label].some((text) => text && foldText(text).includes(q));
      }
      return true;
    });
    const sort = query.sort ?? { field: 'createdAt', direction: 'desc' as const };
    const key = (link: ShareLinkRecord): string | number | null => {
      switch (sort.field) {
        case 'title':
          return link.title;
        case 'status':
          return shareStatusOn(link, criteria.today);
        case 'expiresAt':
          return link.expiresAt;
        case 'viewCount':
          return link.viewCount;
        case 'downloadCount':
          return link.downloadCount;
        case 'lastAccessedAt':
          return link.lastAccessedAt?.toISOString() ?? null;
        default:
          return link.createdAt.toISOString();
      }
    };
    const factor = sort.direction === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const x = key(a);
      const y = key(b);
      if (x === y) return a.id < b.id ? -1 : 1;
      if (x === null) return 1;
      if (y === null) return -1;
      return (x < y ? -1 : 1) * factor;
    });
    const start = (query.page - 1) * query.pageSize;
    return paginated(rows.slice(start, start + query.pageSize), rows.length, query);
  }

  async relationsOf(ids: readonly string[]): Promise<Map<string, ShareLinkRelations>> {
    const result = new Map<string, ShareLinkRelations>();
    for (const id of ids) {
      const link = this.state.links.get(id);
      if (!link) continue;
      const logs = this.logs.filter((row) => row.shareLinkId === id);
      const documents = this.state.documents
        .filter((row) => row.shareLinkId === id)
        .sort((a, b) => a.order - b.order)
        .map((row): ShareDocumentRead => {
          const document = must(this.catalog.get(row.documentId), 'catalog document');
          const servedId = row.versionId ?? document.currentVersionId;
          const served = servedId ? this.versions.get(servedId) : undefined;
          const { accessKeyHash: _hash, ...rest } = row;
          return {
            ...rest,
            document,
            served: served && servedId ? { id: servedId, ...served } : null,
            counters: shareCountersOf(
              logs
                .filter((log) => log.documentId === row.documentId)
                .map((log) => ({ event: log.event, createdAt: log.createdAt.toISOString() })),
            ).counters,
          };
        });
      result.set(id, {
        documents,
        createdBy: this.deps.userRef(link.createdById),
        unlockCount: logs.filter((log) => log.event === 'UNLOCK').length,
        failedUnlockCount: logs.filter((log) => log.event === 'UNLOCK_FAILED').length,
      });
    }
    return result;
  }

  async listAccessLog(criteria: ShareAccessLogCriteria): Promise<Paginated<ShareAccessLogEntry>> {
    const rows = this.logs
      .filter((row) => row.shareLinkId === criteria.shareLinkId)
      .filter((row) => !criteria.events.length || criteria.events.includes(row.event))
      .filter((row) => !criteria.documentId || row.documentId === criteria.documentId)
      .filter((row) => {
        const day = toDateOnly(row.createdAt);
        return (!criteria.from || day >= criteria.from) && (!criteria.to || day <= criteria.to);
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? -1 : 1));
    const { query } = criteria;
    const start = (query.page - 1) * query.pageSize;
    const page = rows.slice(start, start + query.pageSize).map((row): ShareAccessLogEntry => ({
      id: row.id,
      shareLinkId: row.shareLinkId,
      event: row.event,
      documentId: row.documentId,
      documentTitle: row.documentId ? (this.catalog.get(row.documentId)?.title ?? null) : null,
      visitor: row.ipHash.slice(0, 12),
      userAgent: row.userAgent,
      createdAt: row.createdAt,
    }));
    return paginated(page, rows.length, query);
  }
}
