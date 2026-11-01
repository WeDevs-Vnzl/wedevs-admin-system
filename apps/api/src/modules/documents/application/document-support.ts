import { actorOf, type Actor } from '../../../shared/application/actor';
import type { PermissionResource } from '../../../shared/application/authorization';
import type { CurrentUser } from '../../../shared/application/current-user';
import type {
  ActivityEntry,
  ActivityLogPort,
} from '../../../shared/application/ports/activity-log.port';
import type { AuthorizationPort } from '../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../shared/application/ports/clock.port';
import type { IdGeneratorPort } from '../../../shared/application/ports/id-generator.port';
import type { RowLocksPort } from '../../../shared/application/ports/row-locks.port';
import type {
  SearchIndexEntry,
  SearchIndexPort,
} from '../../../shared/application/ports/search-index.port';
import { todayInCaracas, type DateOnly } from '../../../shared/domain/business-date';
import {
  ConflictError,
  NotFoundError,
  ValidationFailedError,
} from '../../../shared/domain/domain-error';
import type { ActivityAction, DocumentFormat, DocumentStatus } from '../../../shared/domain/enums';
import type { EntityRef } from '../../../shared/domain/entity-ref';
import type { NoteLinkTargetRegistry } from '../../commercial/application/note-link-target.registry';
import type { FinanceLookups } from '../../commercial/application/finance-lookups';
import type { ReserveFileForAttachment } from '../../platform/application/use-cases/reserve-file-for-attachment.use-case';
import type { DocumentTypeCatalog } from '../../settings/application/document-type-catalog';
import type { TagAssignments } from '../../settings/application/tag-assignments';
import { assertHttpUrlForLink } from '../domain';
import {
  isDocumentLinkEntityType,
  type CurrentVersionView,
  type DocumentFileMeta,
  type DocumentLinkEntityType,
  type DocumentLinkRecord,
  type DocumentLinkTarget,
  type DocumentRecord,
  type DocumentRepository,
  type UserRef,
} from './ports/document.repository.port';

const INVALID_OPTION_KEY = 'validation.invalidOption';
/** A document hangs from at most this many records (FE `uniqueTargets(30)`). */
export const MAX_DOCUMENT_LINKS = 30;

/** The matrix resource that governs reading each link target type (DT-142). */
export const DOCUMENT_LINK_RESOURCE: Readonly<Record<DocumentLinkEntityType, PermissionResource>> =
  {
    CLIENT: 'client',
    CONTACT: 'contact',
    PROJECT: 'project',
    INVOICE: 'invoice',
    PAYMENT: 'payment',
    EXPENSE: 'expense',
  };

/** The content of a version about to be appended, already checked. */
export interface VersionContent {
  readonly format: DocumentFormat;
  readonly content: string | null;
  readonly fileId: string | null;
  readonly url: string | null;
}

/** First version handed to `createDocument`, or the next one of `uploadVersion`: a `READY` file or an `http(s)` URL. */
export type NewVersionInput =
  | { readonly format: 'ARCHIVO'; readonly fileId: string; readonly changelog?: string | null }
  | { readonly format: 'ENLACE'; readonly url: string; readonly changelog?: string | null };

// ───────────────────────────── Output models ─────────────────────────────

export interface DocumentCategoryRef {
  readonly id: string;
  readonly name: string;
  readonly nameEn: string | null;
  readonly color: string | null;
}

export interface DocumentTypeRef {
  readonly id: string;
  readonly name: string;
  readonly nameEn: string | null;
  readonly defaultFormat: DocumentFormat;
  readonly requiresSignature: boolean;
  readonly hasExpiration: boolean;
}

export interface DocumentTagChip {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

export interface DocumentLinkView {
  readonly id: string;
  readonly entity: EntityRef;
  readonly createdAt: Date;
}

export interface DocumentVersionDetail {
  readonly id: string;
  readonly documentId: string;
  readonly versionNumber: number;
  readonly format: DocumentFormat;
  readonly file: DocumentFileMeta | null;
  readonly url: string | null;
  readonly changelog: string | null;
  readonly createdBy: UserRef;
  readonly createdAt: Date;
  readonly isCurrent: boolean;
  readonly content: string | null;
}

export interface DocumentListRow {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly category: DocumentCategoryRef;
  readonly type: DocumentTypeRef;
  readonly status: DocumentStatus;
  readonly currentFormat: DocumentFormat | null;
  readonly currentVersionNumber: number | null;
  readonly links: readonly EntityRef[];
  readonly expiresAt: DateOnly | null;
  readonly isShared: boolean;
  readonly tags: readonly DocumentTagChip[];
  readonly updatedAt: Date;
  readonly archivedAt: Date | null;
}

export interface DocumentDetail {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly type: DocumentTypeRef;
  readonly category: DocumentCategoryRef;
  readonly summary: string | null;
  readonly status: DocumentStatus;
  readonly effectiveDate: DateOnly | null;
  readonly signedAt: DateOnly | null;
  readonly expiresAt: DateOnly | null;
  readonly alertDaysBefore: number;
  readonly currentVersion: DocumentVersionDetail | null;
  readonly versionCount: number;
  readonly draftContent: string | null;
  readonly draftUpdatedAt: Date | null;
  readonly links: readonly DocumentLinkView[];
  readonly tags: readonly DocumentTagChip[];
  readonly isShared: boolean;
  readonly createdBy: UserRef | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly archivedAt: Date | null;
}

export interface ArchivedDocumentOutput {
  readonly id: string;
  readonly archivedAt: Date;
}

// ───────────────────────────── Shared helpers ─────────────────────────────

/** The document as a tag target (`TagAssignments` takes settings' `TagTarget` shape). */
export function documentTagTarget(id: string): { entityType: 'DOCUMENT'; entityId: string } {
  return { entityType: 'DOCUMENT', entityId: id };
}

export const targetKeyOf = (target: DocumentLinkTarget): string =>
  `${target.entityType}:${target.entityId}`;

export function sameTarget(a: DocumentLinkTarget, b: DocumentLinkTarget): boolean {
  return a.entityType === b.entityType && a.entityId === b.entityId;
}

/** A link list holds no target twice; otherwise `VALIDATION` on `field` (`validation.invalidOption`). */
export function assertDistinctTargets(
  targets: readonly DocumentLinkTarget[],
  field = 'links',
): void {
  const seen = new Set<string>();
  for (const target of targets) {
    const key = targetKeyOf(target);
    if (seen.has(key)) {
      throw new ValidationFailedError({ fieldErrors: { [field]: [INVALID_OPTION_KEY] } });
    }
    seen.add(key);
  }
}

/** The `SearchEntry` of a document (DT-141): `subtitle` is the type name, `body` the summary plus the current markdown. */
export function documentSearchEntry(
  doc: Pick<DocumentRecord, 'id' | 'code' | 'title' | 'summary' | 'status'>,
  typeName: string,
  markdown: string | null,
  archived: boolean,
): SearchIndexEntry {
  const body = [doc.summary, markdown].filter((part): part is string => !!part).join('\n\n');
  return {
    entityType: 'DOCUMENT',
    entityId: doc.id,
    code: doc.code,
    title: doc.title,
    subtitle: typeName,
    body: body === '' ? null : body,
    status: doc.status,
    archived,
  };
}

// ───────────────────────────── Write support ─────────────────────────────

/**
 * What every document write shares (C12, C14, C19, C20): the row lock, the live checks, the link targets,
 * the client-scoped activity entry, the search entry and the version append. The versions package builds on
 * it. Every method that writes is valid only inside the caller's unit of work.
 */
export class DocumentSupport {
  constructor(
    readonly documents: DocumentRepository,
    private readonly catalog: DocumentTypeCatalog,
    private readonly targets: NoteLinkTargetRegistry,
    private readonly lookups: FinanceLookups,
    private readonly authorization: AuthorizationPort,
    private readonly files: ReserveFileForAttachment,
    private readonly activityLog: ActivityLogPort,
    private readonly search: SearchIndexPort,
    private readonly locks: RowLocksPort,
    private readonly clock: ClockPort,
    private readonly ids: IdGeneratorPort,
  ) {}

  now(): Date {
    return this.clock.now();
  }

  /** The Caracas business day (`data-rules.md` §10). */
  today(): DateOnly {
    return todayInCaracas(this.clock.now());
  }

  nextId(): string {
    return this.ids.next();
  }

  /** Takes the `Document` row locks of the unit of work, once and up front (DT-126, DT-146). */
  async lock(documentIds: readonly string[]): Promise<void> {
    await this.locks.lock({ Document: documentIds });
  }

  /** A type a new document or a retyped one may pick: `NOT_FOUND`, or `VALIDATION` on `typeId` when inactive. */
  requireActiveType(id: string) {
    return this.catalog.requireActiveType(id);
  }

  /** The type of an existing document, active or not. */
  requireType(id: string) {
    return this.catalog.requireType(id);
  }

  /** A document that exists and is not archived, else `NOT_FOUND` (C14, C19). */
  async requireLive(id: string): Promise<DocumentRecord> {
    const doc = await this.documents.findById(id);
    if (!doc || doc.deletedAt) throw new NotFoundError();
    return doc;
  }

  canReadTarget(actor: CurrentUser, entityType: DocumentLinkEntityType): boolean {
    return this.authorization.can(actor, 'read', DOCUMENT_LINK_RESOURCE[entityType]);
  }

  /**
   * Link targets a caller may attach or filter by: an unregistered type is `VALIDATION` on `fieldFor(index)`;
   * a type the caller cannot `read` (DT-142), an unknown or an archived record is `NOT_FOUND` (C14, C19).
   * `DOCUMENT` is refused as a target (choice 5). Returns the references, in order.
   */
  async requireLinkTargets(
    actor: CurrentUser,
    targets: readonly DocumentLinkTarget[],
    fieldFor: (index: number) => string,
  ): Promise<EntityRef[]> {
    targets.forEach((target, index) => {
      if (!isDocumentLinkEntityType(target.entityType as string)) {
        throw new ValidationFailedError({
          fieldErrors: { [fieldFor(index)]: [INVALID_OPTION_KEY] },
        });
      }
    });
    for (const target of targets) {
      if (!this.canReadTarget(actor, target.entityType)) throw new NotFoundError();
    }
    return this.targets.requireLive(targets, fieldFor);
  }

  /**
   * The client scope of a document's activity: `clientId` is the first client reached by the links, in link
   * order (a `CLIENT` link, or the clients of a `PROJECT` link), and every client reached is touched.
   */
  async clientScope(
    links: readonly DocumentLinkTarget[],
  ): Promise<{ clientId: string | null; touchClientIds: string[] }> {
    const clientIds: string[] = [];
    const add = (id: string): void => {
      if (!clientIds.includes(id)) clientIds.push(id);
    };
    for (const link of links) {
      if (link.entityType === 'CLIENT') add(link.entityId);
      else if (link.entityType === 'PROJECT') {
        const project = await this.lookups.liveProject(link.entityId);
        for (const clientId of project?.clientIds ?? []) add(clientId);
      }
    }
    return { clientId: clientIds[0] ?? null, touchClientIds: clientIds };
  }

  /**
   * Records one activity entry of a document with its client scope. `links` defaults to the document's stored
   * links; pass them when the caller already holds the final set.
   */
  async record(
    actor: Actor,
    doc: Pick<DocumentRecord, 'id' | 'title'>,
    action: ActivityAction,
    extra: Pick<ActivityEntry, 'changes' | 'metadata'> = {},
    links?: readonly DocumentLinkTarget[],
  ): Promise<void> {
    const targets = links ?? (await this.documents.links(doc.id)).map((link) => link.target);
    const scope = await this.clientScope(targets);
    await this.activityLog.record({
      actor,
      action,
      entityType: 'DOCUMENT',
      entityId: doc.id,
      entityLabel: doc.title,
      ...(scope.clientId ? { clientId: scope.clientId, touchClientIds: scope.touchClientIds } : {}),
      ...extra,
    });
  }

  /** Writes the `SearchEntry` of the document as it is now in the transaction (DT-141). */
  async reindex(doc: DocumentRecord): Promise<void> {
    const type = await this.catalog.requireType(doc.typeId);
    const markdown = await this.documents.currentMarkdown(doc.id);
    await this.search.upsert(documentSearchEntry(doc, type.name, markdown, doc.deletedAt !== null));
  }

  /**
   * Checks a file or link version before anything is written: an `http(s)` URL, or a `READY` file the caller
   * may attach (`File` row lock, C23; C14 `NOT_FOUND`) that no version holds yet (DT-136: `CONFLICT`).
   */
  async prepareVersion(actor: CurrentUser, input: NewVersionInput): Promise<VersionContent> {
    if (input.format === 'ENLACE') {
      return {
        format: 'ENLACE',
        content: null,
        fileId: null,
        url: assertHttpUrlForLink(input.url),
      };
    }
    const file = await this.files.execute(actor, input.fileId);
    if (await this.documents.isFileHeldByVersion(file.id)) throw new ConflictError();
    return { format: 'ARCHIVO', content: null, fileId: file.id, url: null };
  }

  /**
   * Appends version N+1 (immutable) to `doc`, makes it current, reindexes and logs it: `UPLOAD` for a file,
   * `VERSION_PUBLISH` otherwise, with the version number (and the restored one) in the metadata. The caller
   * holds the document row lock.
   */
  async appendVersion(
    actor: CurrentUser,
    doc: DocumentRecord,
    content: VersionContent,
    changelog: string | null,
    restoredFrom?: number,
  ): Promise<{ readonly id: string; readonly versionNumber: number }> {
    const id = this.ids.next();
    const { versionNumber } = await this.documents.appendVersion({
      id,
      documentId: doc.id,
      format: content.format,
      content: content.content,
      fileId: content.fileId,
      url: content.url,
      changelog,
      createdAt: this.clock.now(),
      createdById: actor.userId,
    });
    const current = await this.documents.findById(doc.id);
    await this.reindex(current ?? doc);
    await this.record(
      actorOf(actor),
      doc,
      restoredFrom === undefined && content.fileId ? 'UPLOAD' : 'VERSION_PUBLISH',
      {
        metadata: {
          versionNumber,
          format: content.format,
          ...(restoredFrom === undefined ? {} : { restoredFrom }),
        },
      },
    );
    return { id, versionNumber };
  }
}

// ───────────────────────────── Read models ─────────────────────────────

/** Builds the output models: type and category from the catalog, chips from settings, link labels from the registry. */
export class DocumentViews {
  constructor(
    private readonly documents: DocumentRepository,
    private readonly tags: TagAssignments,
    private readonly catalog: DocumentTypeCatalog,
    private readonly targets: NoteLinkTargetRegistry,
    private readonly authorization: AuthorizationPort,
    private readonly clock: ClockPort,
  ) {}

  async detail(actor: CurrentUser, doc: DocumentRecord): Promise<DocumentDetail> {
    const today = todayInCaracas(this.clock.now());
    const relations = (await this.documents.relationsOf([doc.id], today)).get(doc.id);
    const [{ types, categories }, chips, links] = await Promise.all([
      this.catalogRefs(),
      this.tags.chipsFor([documentTagTarget(doc.id)]),
      this.linkViews(actor, relations?.links ?? []),
    ]);
    const type = types.get(doc.typeId);
    const category = type ? categories.get(type.categoryId) : undefined;
    if (!type || !category) throw new NotFoundError();
    const current = relations?.currentVersion ?? null;
    return {
      id: doc.id,
      code: doc.code,
      title: doc.title,
      type: type.ref,
      category,
      summary: doc.summary,
      status: doc.status,
      effectiveDate: doc.effectiveDate,
      signedAt: doc.signedAt,
      expiresAt: doc.expiresAt,
      alertDaysBefore: doc.alertDaysBefore,
      currentVersion: current ? versionDetail(current) : null,
      versionCount: relations?.versionCount ?? 0,
      draftContent: doc.draftContent,
      draftUpdatedAt: doc.draftUpdatedAt,
      links,
      tags: chips.get(`DOCUMENT:${doc.id}`) ?? [],
      isShared: relations?.isShared ?? false,
      createdBy: relations?.createdBy ?? null,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      archivedAt: doc.deletedAt,
    };
  }

  async rows(actor: CurrentUser, docs: readonly DocumentRecord[]): Promise<DocumentListRow[]> {
    if (docs.length === 0) return [];
    const today = todayInCaracas(this.clock.now());
    const relations = await this.documents.relationsOf(
      docs.map((doc) => doc.id),
      today,
    );
    const { types, categories } = await this.catalogRefs();
    const chips = await this.tags.chipsFor(docs.map((doc) => documentTagTarget(doc.id)));
    const resolved = await this.resolveLinks(
      actor,
      docs.flatMap((doc) => (relations.get(doc.id)?.links ?? []).map((link) => link.target)),
    );
    return docs.flatMap((doc) => {
      const type = types.get(doc.typeId);
      const category = type ? categories.get(type.categoryId) : undefined;
      if (!type || !category) return [];
      const rel = relations.get(doc.id);
      return [
        {
          id: doc.id,
          code: doc.code,
          title: doc.title,
          category,
          type: type.ref,
          status: doc.status,
          currentFormat: rel?.currentVersion?.format ?? null,
          currentVersionNumber: rel?.currentVersion?.versionNumber ?? null,
          links: (rel?.links ?? []).flatMap((link) => {
            const ref = resolved.get(targetKeyOf(link.target));
            return ref ? [ref] : [];
          }),
          expiresAt: doc.expiresAt,
          isShared: rel?.isShared ?? false,
          tags: chips.get(`DOCUMENT:${doc.id}`) ?? [],
          updatedAt: doc.updatedAt,
          archivedAt: doc.deletedAt,
        },
      ];
    });
  }

  /** The links of a document the caller may see (DT-142), resolved; a target that no longer resolves is left out. */
  async links(actor: CurrentUser, documentId: string): Promise<DocumentLinkView[]> {
    return this.linkViews(actor, await this.documents.links(documentId));
  }

  private async linkViews(
    actor: CurrentUser,
    links: readonly DocumentLinkRecord[],
  ): Promise<DocumentLinkView[]> {
    const resolved = await this.resolveLinks(
      actor,
      links.map((link) => link.target),
    );
    return links.flatMap((link) => {
      const entity = resolved.get(targetKeyOf(link.target));
      return entity ? [{ id: link.id, entity, createdAt: link.createdAt }] : [];
    });
  }

  /** References of the targets the caller may `read` (DT-142), keyed by `targetKeyOf`. */
  private async resolveLinks(
    actor: CurrentUser,
    targets: readonly DocumentLinkTarget[],
  ): Promise<Map<string, EntityRef>> {
    const visible = targets.filter((target) =>
      this.authorization.can(actor, 'read', DOCUMENT_LINK_RESOURCE[target.entityType]),
    );
    const found = await this.targets.resolve(visible);
    const result = new Map<string, EntityRef>();
    for (const target of visible) {
      const key = targetKeyOf(target);
      const entry = found.get(key);
      if (entry) result.set(key, entry.ref);
    }
    return result;
  }

  private async catalogRefs() {
    const [typeRows, categoryRows] = await Promise.all([
      this.catalog.listTypes(),
      this.catalog.listCategories(),
    ]);
    const categories = new Map<string, DocumentCategoryRef>(
      categoryRows.map((category) => [
        category.id,
        {
          id: category.id,
          name: category.name,
          nameEn: category.nameEn,
          color: category.color,
        },
      ]),
    );
    const types = new Map(
      typeRows.map((type) => [
        type.id,
        {
          categoryId: type.categoryId,
          ref: {
            id: type.id,
            name: type.name,
            nameEn: type.nameEn,
            defaultFormat: type.defaultFormat,
            requiresSignature: type.requiresSignature,
            hasExpiration: type.hasExpiration,
          } satisfies DocumentTypeRef,
        },
      ]),
    );
    return { categories, types };
  }
}

function versionDetail(version: CurrentVersionView): DocumentVersionDetail {
  return {
    id: version.id,
    documentId: version.documentId,
    versionNumber: version.versionNumber,
    format: version.format,
    file: version.file,
    url: version.url,
    changelog: version.changelog,
    createdBy: version.createdBy,
    createdAt: version.createdAt,
    isCurrent: true,
    content: version.content,
  };
}
