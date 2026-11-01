import type {
  CurrentVersionView,
  DocumentFileMeta,
  DocumentLinkRecord,
  DocumentLinkTarget,
  DocumentListCriteria,
  DocumentMetaPatch,
  DocumentRecord,
  DocumentRelations,
  DocumentRepository,
  NewDocument,
  NewDocumentVersion,
  UserRef,
} from '../../../../src/modules/documents/application/ports/document.repository.port';
import type { DateOnly } from '../../../../src/shared/domain/business-date';
import type { DocumentStatus } from '../../../../src/shared/domain/enums';
import { foldText } from '../../../../src/shared/domain/list-query';
import { paginated, type Paginated } from '../../../../src/shared/domain/pagination';
import type {
  InMemoryUnitOfWork,
  TransactionParticipant,
} from '../../../support/fakes/in-memory-unit-of-work';

export interface InMemoryDocumentDeps {
  categoryOfType(typeId: string): string | null;
  userRef(id: string): UserRef;
  file(id: string): DocumentFileMeta;
  tagIdsOf(documentId: string): string[];
  /** Share links the fake knows: document id -> `{ revokedAt, expiresAt }` of each link it sits in. */
  sharesOf(documentId: string): { revokedAt: Date | null; expiresAt: DateOnly | null }[];
}

interface StoredVersion extends NewDocumentVersion {
  readonly versionNumber: number;
}

interface State {
  documents: Map<string, DocumentRecord>;
  links: Map<string, DocumentLinkRecord[]>;
  versions: StoredVersion[];
}

const copyState = (state: State): State => ({
  documents: new Map(state.documents),
  links: new Map([...state.links].map(([id, list]) => [id, [...list]])),
  versions: [...state.versions],
});

const sameTarget = (a: DocumentLinkTarget, b: DocumentLinkTarget): boolean =>
  a.entityType === b.entityType && a.entityId === b.entityId;

/** `Document`, links and versions in memory with the committed/pending split of the unit of work. */
export class InMemoryDocumentRepository implements DocumentRepository, TransactionParticipant {
  private committed: State = { documents: new Map(), links: new Map(), versions: [] };
  private pending: State = copyState(this.committed);
  /** Number of writes, so a test can assert "nothing written". */
  writeCount = 0;

  constructor(
    private readonly uow: InMemoryUnitOfWork,
    private readonly deps: InMemoryDocumentDeps,
  ) {
    uow.enlist(this);
  }

  private get state(): State {
    return this.uow.isActive ? this.pending : this.committed;
  }

  private write(what: string): State {
    this.uow.assertActive(`DocumentRepository.${what}`);
    this.writeCount += 1;
    return this.pending;
  }

  /** Committed rows, archived ones included. */
  get rows(): DocumentRecord[] {
    return [...this.committed.documents.values()];
  }

  committedLinks(documentId: string): DocumentLinkRecord[] {
    return [...(this.committed.links.get(documentId) ?? [])];
  }

  committedVersions(documentId: string): StoredVersion[] {
    return this.committed.versions.filter((v) => v.documentId === documentId);
  }

  /** Test helper: a committed row replaced as-is (e.g. an expired date the use case cannot create). */
  seed(row: DocumentRecord): void {
    this.committed.documents.set(row.id, row);
    this.pending.documents.set(row.id, row);
  }

  async insert(document: NewDocument): Promise<void> {
    const state = this.write('insert');
    state.documents.set(document.id, {
      ...document,
      updatedAt: document.createdAt,
      deletedAt: null,
    });
  }

  async findById(id: string): Promise<DocumentRecord | null> {
    return this.state.documents.get(id) ?? null;
  }

  async list(criteria: DocumentListCriteria): Promise<Paginated<DocumentRecord>> {
    const { query } = criteria;
    const matches = this.filtered(criteria, false);
    const sort = query.sort ?? { field: 'updatedAt', direction: 'desc' as const };
    const key = (doc: DocumentRecord): string | number | null => {
      switch (sort.field) {
        case 'code':
          return doc.code;
        case 'title':
          return doc.title;
        case 'status':
          return doc.status;
        case 'expiresAt':
          return doc.expiresAt;
        case 'createdAt':
          return doc.createdAt.getTime();
        case 'versionNumber':
          return this.currentOf(doc)?.versionNumber ?? null;
        case 'format':
          return this.currentOf(doc)?.format ?? null;
        default:
          return doc.updatedAt.getTime();
      }
    };
    const dir = sort.direction === 'asc' ? 1 : -1;
    matches.sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      if (ka === null || kb === null) {
        if (ka === kb) return a.id < b.id ? -1 : 1;
        return ka === null ? 1 : -1;
      }
      if (ka === kb) return a.id < b.id ? -1 : 1;
      return (ka < kb ? -1 : 1) * dir;
    });
    const start = (query.page - 1) * query.pageSize;
    return paginated(matches.slice(start, start + query.pageSize), matches.length, query);
  }

  async countByCategory(criteria: DocumentListCriteria): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const doc of this.filtered(criteria, true)) {
      const category = this.deps.categoryOfType(doc.typeId);
      if (category) counts[category] = (counts[category] ?? 0) + 1;
    }
    return counts;
  }

  /** The SQL list in miniature: `q` is a code/title contains (the real one goes through `SearchEntry`). */
  private filtered(c: DocumentListCriteria, ignoreCategory: boolean): DocumentRecord[] {
    const needle = c.query.q ? foldText(c.query.q) : null;
    return [...this.state.documents.values()].filter((doc) => {
      if (c.query.archived === 'exclude' && doc.deletedAt) return false;
      if (c.query.archived === 'only' && !doc.deletedAt) return false;
      if (c.statuses.length > 0 && !c.statuses.includes(doc.status)) return false;
      if (c.typeIds.length > 0 && !c.typeIds.includes(doc.typeId)) return false;
      const category = this.deps.categoryOfType(doc.typeId);
      if (!ignoreCategory && c.categoryIds.length > 0 && !c.categoryIds.includes(category ?? '')) {
        return false;
      }
      const current = this.currentOf(doc);
      if (c.formats.length > 0 && !(current && c.formats.includes(current.format))) return false;
      const targets = (this.state.links.get(doc.id) ?? []).map((link) => link.target);
      const facet = (type: DocumentLinkTarget['entityType'], ids: readonly string[]): boolean =>
        ids.length === 0 || targets.some((t) => t.entityType === type && ids.includes(t.entityId));
      if (
        !facet('CLIENT', c.clientIds) ||
        !facet('CONTACT', c.contactIds) ||
        !facet('PROJECT', c.projectIds) ||
        !facet('INVOICE', c.invoiceIds) ||
        !facet('PAYMENT', c.paymentIds) ||
        !facet('EXPENSE', c.expenseIds)
      ) {
        return false;
      }
      if (c.tagIds.length > 0 && !this.deps.tagIdsOf(doc.id).some((id) => c.tagIds.includes(id))) {
        return false;
      }
      if (c.expiresFrom && !(doc.expiresAt && doc.expiresAt >= c.expiresFrom)) return false;
      if (c.expiresTo && !(doc.expiresAt && doc.expiresAt <= c.expiresTo)) return false;
      if (c.expiring) {
        const ok =
          doc.expiresAt !== null &&
          doc.expiresAt >= c.expiring.from &&
          doc.expiresAt <= c.expiring.to &&
          doc.status !== 'VENCIDO' &&
          doc.status !== 'ANULADO';
        if (!ok) return false;
      }
      if (c.staleBefore && !(doc.status === 'BORRADOR' && doc.updatedAt < c.staleBefore)) {
        return false;
      }
      if (c.shared !== null && this.isShared(doc.id, c.today) !== c.shared) return false;
      if (needle && !foldText(`${doc.code} ${doc.title}`).includes(needle)) return false;
      return true;
    });
  }

  private isShared(documentId: string, today: DateOnly): boolean {
    return this.deps
      .sharesOf(documentId)
      .some((share) => share.revokedAt === null && (!share.expiresAt || share.expiresAt >= today));
  }

  private currentOf(doc: DocumentRecord): StoredVersion | null {
    return this.state.versions.find((v) => v.id === doc.currentVersionId) ?? null;
  }

  async relationsOf(
    ids: readonly string[],
    today: DateOnly,
  ): Promise<Map<string, DocumentRelations>> {
    const result = new Map<string, DocumentRelations>();
    for (const id of ids) {
      const doc = this.state.documents.get(id);
      if (!doc) continue;
      const stored = this.currentOf(doc);
      const current: CurrentVersionView | null = stored
        ? {
            id: stored.id,
            documentId: stored.documentId,
            versionNumber: stored.versionNumber,
            format: stored.format,
            content: stored.content,
            file: stored.fileId ? this.deps.file(stored.fileId) : null,
            url: stored.url,
            changelog: stored.changelog,
            createdBy: this.deps.userRef(stored.createdById),
            createdAt: stored.createdAt,
          }
        : null;
      result.set(id, {
        currentVersion: current,
        versionCount: this.state.versions.filter((v) => v.documentId === id).length,
        links: [...(this.state.links.get(id) ?? [])],
        isShared: this.isShared(id, today),
        createdBy: doc.createdById ? this.deps.userRef(doc.createdById) : null,
      });
    }
    return result;
  }

  async labels(
    ids: readonly string[],
  ): Promise<Map<string, { code: string; title: string; archived: boolean }>> {
    const result = new Map<string, { code: string; title: string; archived: boolean }>();
    for (const id of ids) {
      const doc = this.state.documents.get(id);
      if (doc)
        result.set(id, { code: doc.code, title: doc.title, archived: doc.deletedAt !== null });
    }
    return result;
  }

  private mutate(id: string, change: Partial<DocumentRecord>): void {
    const doc = this.state.documents.get(id);
    if (!doc) throw new Error(`Document ${id} not found`);
    this.state.documents.set(id, { ...doc, ...change });
  }

  async updateMeta(id: string, patch: DocumentMetaPatch): Promise<void> {
    this.write('updateMeta');
    const { updatedById: _by, ...fields } = patch;
    this.mutate(id, fields);
  }

  async setStatus(
    id: string,
    change: {
      readonly status: DocumentStatus;
      readonly signedAt: DateOnly | null;
      readonly updatedAt: Date;
      readonly updatedById: string | null;
    },
  ): Promise<void> {
    this.write('setStatus');
    this.mutate(id, {
      status: change.status,
      signedAt: change.signedAt,
      updatedAt: change.updatedAt,
    });
  }

  async archive(ids: readonly string[], at: Date): Promise<void> {
    this.write('archive');
    for (const id of ids) this.mutate(id, { deletedAt: at, updatedAt: at });
  }

  async restore(id: string, at: Date): Promise<void> {
    this.write('restore');
    this.mutate(id, { deletedAt: null, updatedAt: at });
  }

  async links(documentId: string): Promise<DocumentLinkRecord[]> {
    return [...(this.state.links.get(documentId) ?? [])];
  }

  async addLink(
    documentId: string,
    target: DocumentLinkTarget,
    link: { readonly id: string; readonly createdAt: Date },
  ): Promise<boolean> {
    const state = this.write('addLink');
    const list = state.links.get(documentId) ?? [];
    if (list.some((existing) => sameTarget(existing.target, target))) return false;
    state.links.set(documentId, [...list, { id: link.id, target, createdAt: link.createdAt }]);
    return true;
  }

  async removeLink(documentId: string, target: DocumentLinkTarget): Promise<boolean> {
    const state = this.write('removeLink');
    const list = state.links.get(documentId) ?? [];
    const kept = list.filter((existing) => !sameTarget(existing.target, target));
    state.links.set(documentId, kept);
    return kept.length !== list.length;
  }

  async isFileHeldByVersion(fileId: string): Promise<boolean> {
    return this.state.versions.some((v) => v.fileId === fileId);
  }

  async appendVersion(version: NewDocumentVersion): Promise<{ readonly versionNumber: number }> {
    const state = this.write('appendVersion');
    const versionNumber =
      Math.max(
        0,
        ...state.versions
          .filter((v) => v.documentId === version.documentId)
          .map((v) => v.versionNumber),
      ) + 1;
    state.versions.push({ ...version, versionNumber });
    this.mutate(version.documentId, { currentVersionId: version.id, updatedAt: version.createdAt });
    return { versionNumber };
  }

  async currentMarkdown(documentId: string): Promise<string | null> {
    const doc = this.state.documents.get(documentId);
    const current = doc ? this.currentOf(doc) : null;
    return current && current.format === 'MARKDOWN' ? current.content : null;
  }

  async expiredIds(today: DateOnly): Promise<string[]> {
    return [...this.state.documents.values()]
      .filter(
        (doc) =>
          !doc.deletedAt &&
          doc.status !== 'ANULADO' &&
          doc.status !== 'VENCIDO' &&
          doc.expiresAt !== null &&
          doc.expiresAt < today,
      )
      .map((doc) => doc.id)
      .sort();
  }

  begin(): void {
    this.pending = copyState(this.committed);
  }

  commit(): void {
    this.committed = this.pending;
    this.pending = copyState(this.committed);
  }

  rollback(): void {
    this.pending = copyState(this.committed);
  }
}
