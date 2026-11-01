import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import type { IdGeneratorPort } from '../../../../../shared/application/ports/id-generator.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import {
  toDateOnly,
  todayInCaracas,
  type DateOnly,
} from '../../../../../shared/domain/business-date';
import { NotFoundError } from '../../../../../shared/domain/domain-error';
import type { DocumentFormat, ShareEvent } from '../../../../../shared/domain/enums';
import type { NoteLinkTargetRegistry } from '../../../../commercial/application/note-link-target.registry';
import type { DocumentTypeCatalog } from '../../../../settings/application/document-type-catalog';
import { isWellFormedShareToken, shareStatusOn } from '../../../domain';
import type { PortalDocumentRow, PortalReadPort } from '../../ports/portal-read.port';
import type {
  ShareLinkRecord,
  ShareLinkRepository,
  ShareLocale,
} from '../../ports/share-link.repository.port';
import type { ShareAccessLogPort } from '../../ports/share-access-log.port';
import type { ShareSecretsPort, UnlockGrant } from '../../ports/share-secrets.port';

// What the interface layer needs of the domain constants (it may not import `domain/` itself).
export {
  ACCESS_KEY_MAX_LENGTH,
  ACCESS_KEY_MIN_LENGTH,
  UNLOCK_COOKIE_MAX_AGE_SECONDS,
} from '../../../domain';

/** The user agent is stored capped at 512 characters (`ShareAccessLog.userAgent`). */
export const MAX_USER_AGENT_LENGTH = 512;

/**
 * What the portal knows of a visitor (DT-45, DT-143): the request IP (`req.ip`, which follows the trusted
 * proxy hops), the user agent, and the raw value of the unlock cookie. Only the cookie can mark a document as
 * unlocked; a body field never can.
 */
export interface PortalVisitor {
  readonly ip: string;
  readonly userAgent?: string | undefined;
  readonly unlockCookie?: string | undefined;
}

/** A document as the portal page lists it. No internal id beyond `documentId`, no author, no file key. */
export interface PortalDocument {
  readonly documentId: string;
  readonly title: string;
  readonly typeName: string;
  readonly typeNameEn: string | null;
  readonly versionNumber: number;
  readonly versionDate: DateOnly;
  readonly format: DocumentFormat;
  /** `true` while the document requires a key the visitor has not entered. */
  readonly locked: boolean;
}

export interface PortalShare {
  readonly title: string;
  readonly message: string | null;
  readonly locale: ShareLocale;
  readonly allowDownload: boolean;
  readonly clientName: string | null;
  readonly expiresAt: DateOnly | null;
  readonly documents: readonly PortalDocument[];
}

export type PortalDocumentContent =
  | { readonly format: 'MARKDOWN'; readonly markdown: string }
  | { readonly format: 'ENLACE'; readonly url: string }
  | {
      readonly format: 'ARCHIVO';
      readonly fileName: string;
      readonly mimeType: string;
      readonly sizeBytes: number;
      readonly preview: 'pdf' | 'image' | 'none';
    };

export interface PortalDocumentView {
  readonly document: PortalDocument & { readonly locked: false };
  readonly content: PortalDocumentContent;
}

/** Type names for the chip; `DocumentTypeCatalog` satisfies it. */
export type PortalTypeNames = Pick<DocumentTypeCatalog, 'listTypes'>;
/** The client label for the header; `NoteLinkTargetRegistry` satisfies it. */
export type PortalClientLabels = Pick<NoteLinkTargetRegistry, 'resolve'>;

export function previewOf(mimeType: string): 'pdf' | 'image' | 'none' {
  if (mimeType === 'application/pdf') return 'pdf';
  return mimeType.startsWith('image/') ? 'image' : 'none';
}

/** `http` and `https` only: the stored URL of an `ENLACE` version is never trusted blindly at delivery. */
export function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * What the five portal use cases share (C22, DT-45). The token is the only authority: there is no session and
 * no `can()`. Everything about the link the visitor may not learn is one bare `NotFoundError`.
 */
export class PortalSupport {
  constructor(
    readonly shares: ShareLinkRepository,
    readonly read: PortalReadPort,
    readonly secrets: ShareSecretsPort,
    private readonly accessLog: ShareAccessLogPort,
    private readonly uow: UnitOfWorkPort,
    private readonly clock: ClockPort,
    private readonly ids: IdGeneratorPort,
    private readonly typeNames: PortalTypeNames,
    private readonly clients: PortalClientLabels,
  ) {}

  now(): Date {
    return this.clock.now();
  }

  nextId(): string {
    return this.ids.next();
  }

  /**
   * The live link behind `token`. A malformed, unknown, revoked or expired (by date, in Caracas) token is the
   * same `NOT_FOUND`: the visitor cannot tell which (C22).
   */
  async liveLink(token: string): Promise<ShareLinkRecord> {
    if (!isWellFormedShareToken(token)) throw new NotFoundError();
    const link = await this.shares.findByToken(token);
    if (!link || shareStatusOn(link, todayInCaracas(this.now())) !== 'ACTIVE') {
      throw new NotFoundError();
    }
    return link;
  }

  /** The documents of the link that can be served now, in display order. */
  documentsOf(link: ShareLinkRecord): Promise<PortalDocumentRow[]> {
    return this.read.documentsOf(link.id);
  }

  /** A document of the link, or `NOT_FOUND` when it is outside the link, archived or has nothing to serve. */
  async sharedDocument(link: ShareLinkRecord, documentId: string): Promise<PortalDocumentRow> {
    const found = (await this.documentsOf(link)).find((row) => row.documentId === documentId);
    if (!found) throw new NotFoundError();
    return found;
  }

  /** The ids the signed cookie of this visitor unlocks for this link; `[]` for anything not valid. */
  unlockedIds(visitor: PortalVisitor, token: string): string[] {
    return this.unlockGrants(visitor, token).map((grant) => grant.documentId);
  }

  /** The live grants of the cookie, each with its own expiry; `[]` for anything not valid. */
  unlockGrants(visitor: PortalVisitor, token: string): UnlockGrant[] {
    return this.secrets.verifyUnlock(visitor.unlockCookie, token, this.now());
  }

  isLocked(document: PortalDocumentRow, unlockedIds: readonly string[]): boolean {
    return document.requiresKey && !unlockedIds.includes(document.documentId);
  }

  ipHashOf(visitor: PortalVisitor): string {
    return this.secrets.hashIp(visitor.ip);
  }

  userAgentOf(visitor: PortalVisitor): string | null {
    const agent = visitor.userAgent?.slice(0, MAX_USER_AGENT_LENGTH);
    return agent ? agent : null;
  }

  /** The type names by id; an unknown type reads as an empty name, never an error. */
  async typeNamesById(): Promise<Map<string, { name: string; nameEn: string | null }>> {
    const types = await this.typeNames.listTypes();
    return new Map(types.map((type) => [type.id, { name: type.name, nameEn: type.nameEn }]));
  }

  async toPortalDocument(
    row: PortalDocumentRow,
    unlockedIds: readonly string[],
    names?: Map<string, { name: string; nameEn: string | null }>,
  ): Promise<PortalDocument> {
    const type = (names ?? (await this.typeNamesById())).get(row.typeId);
    return {
      documentId: row.documentId,
      title: row.title,
      typeName: type?.name ?? '',
      typeNameEn: type?.nameEn ?? null,
      versionNumber: row.version.versionNumber,
      versionDate: toDateOnly(row.version.createdAt),
      format: row.version.format,
      locked: this.isLocked(row, unlockedIds),
    };
  }

  /** Trade name of the client, archived or not (an old link keeps its header); `null` without one. */
  async clientName(link: ShareLinkRecord): Promise<string | null> {
    if (!link.clientId) return null;
    const resolved = await this.clients.resolve([
      { entityType: 'CLIENT', entityId: link.clientId },
    ]);
    return resolved.get(`CLIENT:${link.clientId}`)?.ref.label ?? null;
  }

  /**
   * Appends one access-log row and moves the stored counters (A1, contract choice 4). `ReadCommitted`: it reads
   * nothing, one insert plus an atomic increment, so simultaneous views never answer `CONFLICT`.
   */
  async logAccess(
    link: ShareLinkRecord,
    event: Extract<ShareEvent, 'VIEW' | 'DOWNLOAD'>,
    documentId: string | null,
    visitor: PortalVisitor,
  ): Promise<void> {
    await this.uow.run(
      () =>
        this.accessLog.append({
          id: this.nextId(),
          shareLinkId: link.id,
          event,
          documentId,
          ipHash: this.ipHashOf(visitor),
          userAgent: this.userAgentOf(visitor),
          createdAt: this.now(),
        }),
      { isolation: 'ReadCommitted' },
    );
  }
}
