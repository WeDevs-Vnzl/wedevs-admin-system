import { NoteLinkTargetRegistry } from '../../../src/modules/commercial/application/note-link-target.registry';
import type {
  DocumentVersionRepository,
  DocumentVersionWithContent,
} from '../../../src/modules/documents/application/ports/document-version.repository.port';
import type { UserRef } from '../../../src/modules/documents/application/ports/document.repository.port';
import type {
  PortalDocumentRow,
  PortalReadPort,
} from '../../../src/modules/documents/application/ports/portal-read.port';
import type { ShareLinkRecord } from '../../../src/modules/documents/application/ports/share-link.repository.port';
import { GetSharedDocumentDelivery } from '../../../src/modules/documents/application/use-cases/portal/get-shared-document-delivery.use-case';
import { GetSharedDocument } from '../../../src/modules/documents/application/use-cases/portal/get-shared-document.use-case';
import {
  PortalSupport,
  type PortalVisitor,
} from '../../../src/modules/documents/application/use-cases/portal/portal-support';
import { RecordShareView } from '../../../src/modules/documents/application/use-cases/portal/record-share-view.use-case';
import { ResolveShareToken } from '../../../src/modules/documents/application/use-cases/portal/resolve-share-token.use-case';
import { UnlockSharedDocument } from '../../../src/modules/documents/application/use-cases/portal/unlock-shared-document.use-case';
import { NodeShareSecrets } from '../../../src/modules/documents/infrastructure/node-share-secrets';
import type { DocumentFormat } from '../../../src/shared/domain/enums';
import { FakeNoteTargets } from '../../commercial/notes/fakes/fake-note-targets';
import { FixedClock } from '../../support/fakes/fixed-clock';
import { InMemoryRowLocks } from '../../support/fakes/in-memory-row-locks';
import { InMemoryUnitOfWork } from '../../support/fakes/in-memory-unit-of-work';
import { SequentialIdGenerator } from '../../support/fakes/sequential-id-generator';
import { InMemoryShareLinkRepository } from '../shares/fakes/in-memory-share-link.repository';
import { InMemoryShareAccessLog } from './fakes/in-memory-share-access-log';

export const TOKEN = 'K'.repeat(43);
export const OTHER_TOKEN = 'L'.repeat(43);
export const KEY = 'KAIRO-STAGE-2026';
export const UNLOCK_SECRET = 'fake-unlock-secret-not-real-0000000000';
export const IP_SALT = 'fake-ip-salt-not-real-000000000000000';
const AUTHOR: UserRef = { id: 'usr_author', name: 'Author', imageUrl: null };

export interface SeedDocument {
  readonly id: string;
  readonly code?: string;
  readonly title?: string;
  readonly typeId?: string;
  readonly format?: DocumentFormat;
  readonly versionNumber?: number;
  readonly content?: string;
  readonly url?: string;
  readonly file?: { id: string; name: string; mime: string; size: number; status?: string };
  /** The clear key; the hash is made by the world's real secrets. */
  readonly key?: string;
  readonly createdAt?: Date;
}

/** A recording stand-in for `IssueFileDeliveryUrl`. */
export class FakeFileDelivery {
  readonly calls: { fileId: string; disposition?: string; ttlMs: number }[] = [];
  async execute(
    fileId: string,
    options: { disposition?: 'inline' | 'attachment'; ttlMs: number },
  ): Promise<{ url: string; expiresAt: Date; fileName: string; mimeType: string }> {
    this.calls.push({ fileId, ...options });
    return {
      url: `https://files.test/${fileId}?d=${options.disposition ?? 'attachment'}`,
      expiresAt: new Date(0),
      fileName: 'x',
      mimeType: 'x',
    };
  }
}

/** The portal use cases over in-memory ports and the real secrets adapter (cheap fake secrets, real scrypt). */
export function createPortalWorld() {
  const clock = new FixedClock('2026-10-30T12:00:00.000Z');
  const uow = new InMemoryUnitOfWork();
  const locks = new InMemoryRowLocks(uow);
  const secrets = new NodeShareSecrets({ unlockSecret: UNLOCK_SECRET, ipSalt: IP_SALT });
  const shares = new InMemoryShareLinkRepository(uow, {
    userRef: () => AUTHOR,
    clientLabel: () => null,
  });
  const accessLog = new InMemoryShareAccessLog(uow);
  const noteTargets = new FakeNoteTargets();
  const clients = new NoteLinkTargetRegistry(noteTargets);
  const files = new FakeFileDelivery();

  const rows = new Map<string, PortalDocumentRow[]>();
  const versions = new Map<string, DocumentVersionWithContent>();
  const read: PortalReadPort = { documentsOf: async (linkId) => rows.get(linkId) ?? [] };
  const versionRepo = {
    findInDocument: async (documentId: string, versionId: string) => {
      const found = versions.get(versionId);
      return found && found.documentId === documentId ? found : null;
    },
  } as unknown as DocumentVersionRepository;
  const types = {
    listTypes: async () => [
      {
        id: 'dtyp_nda',
        categoryId: 'c',
        name: 'Acuerdo de confidencialidad',
        nameEn: 'NDA',
        requiresSignature: false,
        hasExpiration: false,
        defaultFormat: 'MARKDOWN' as const,
        active: true,
      },
    ],
  };

  const support = new PortalSupport(
    shares,
    read,
    secrets,
    accessLog,
    uow,
    clock,
    new SequentialIdGenerator('acc'),
    types,
    clients,
  );
  const world = {
    clock,
    uow,
    locks,
    secrets,
    shares,
    accessLog,
    noteTargets,
    files,
    support,
    resolve: new ResolveShareToken(support),
    recordView: new RecordShareView(support),
    unlock: new UnlockSharedDocument(support, uow, locks, accessLog, accessLog),
    getDocument: new GetSharedDocument(support, versionRepo),
    getDelivery: new GetSharedDocumentDelivery(support, versionRepo, files),

    /** A link with its documents (the order is the array order). Keys are scrypt-hashed here, once. */
    async seedLink(
      documents: readonly SeedDocument[],
      over: Partial<ShareLinkRecord> = {},
    ): Promise<ShareLinkRecord> {
      const link: ShareLinkRecord = {
        id: 'shr_a',
        token: TOKEN,
        title: 'Entrega de documentación',
        message: null,
        clientId: null,
        locale: 'es',
        allowDownload: true,
        expiresAt: null,
        expiredAt: null,
        revokedAt: null,
        viewCount: 0,
        downloadCount: 0,
        lastAccessedAt: null,
        createdAt: clock.now(),
        createdById: 'usr_author',
        ...over,
      };
      const writes = [];
      const portalRows: PortalDocumentRow[] = [];
      for (const [order, doc] of documents.entries()) {
        const format = doc.format ?? 'MARKDOWN';
        const versionId = `${doc.id}_v1`;
        const hash = doc.key ? await secrets.hashKey(doc.key) : null;
        writes.push({
          documentId: doc.id,
          versionId: null,
          order,
          key: hash
            ? { kind: 'set' as const, hash, updatedAt: clock.now() }
            : { kind: 'keep' as const },
        });
        const createdAt = doc.createdAt ?? new Date('2026-10-20T15:00:00.000Z');
        const versionNumber = doc.versionNumber ?? 1;
        portalRows.push({
          documentId: doc.id,
          order,
          requiresKey: hash !== null,
          code: doc.code ?? `DOC-${doc.id}`,
          title: doc.title ?? `Documento ${doc.id}`,
          typeId: doc.typeId ?? 'dtyp_nda',
          version: { id: versionId, versionNumber, format, createdAt },
        });
        versions.set(versionId, {
          id: versionId,
          documentId: doc.id,
          versionNumber,
          format,
          file: doc.file
            ? {
                id: doc.file.id,
                originalName: doc.file.name,
                mimeType: doc.file.mime,
                sizeBytes: doc.file.size,
                status: doc.file.status ?? 'READY',
                uploadedById: AUTHOR.id,
                createdAt,
              }
            : null,
          url: doc.url ?? null,
          changelog: null,
          createdBy: AUTHOR,
          createdAt,
          isCurrent: true,
          content: format === 'MARKDOWN' ? (doc.content ?? '# Hola') : null,
        });
      }
      shares.seedLink(link, writes);
      rows.set(link.id, portalRows);
      return link;
    },
    /** Removes a document from what the portal serves (archived since the link was made). */
    archive(linkId: string, documentId: string): void {
      rows.set(
        linkId,
        (rows.get(linkId) ?? []).filter((row) => row.documentId !== documentId),
      );
    },
    cookieFor(documentIds: string[], token = TOKEN): string {
      return secrets.signUnlock({ token, documentIds, now: clock.now() });
    },
  };
  return world;
}
export type PortalWorld = ReturnType<typeof createPortalWorld>;

export const visitor = (over: Partial<PortalVisitor> = {}): PortalVisitor => ({
  ip: '203.0.113.7',
  userAgent: 'Vitest',
  ...over,
});
