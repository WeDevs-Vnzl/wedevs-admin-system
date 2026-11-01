import type { Actor } from '../../../../../shared/application/actor';
import type { ActivityLogPort } from '../../../../../shared/application/ports/activity-log.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import type { IdGeneratorPort } from '../../../../../shared/application/ports/id-generator.port';
import type { RowLocksPort } from '../../../../../shared/application/ports/row-locks.port';
import {
  isValidDateOnly,
  todayInCaracas,
  type DateOnly,
} from '../../../../../shared/domain/business-date';
import {
  NotFoundError,
  ValidationFailedError,
  type FieldErrors,
} from '../../../../../shared/domain/domain-error';
import type { DocumentFormat, DocumentStatus } from '../../../../../shared/domain/enums';
import type { EntityRef } from '../../../../../shared/domain/entity-ref';
import type { NoteLinkTargetRegistry } from '../../../../commercial/application/note-link-target.registry';
import { shareStatusOn, type ShareCounters, type ShareStatus } from '../../../domain';
import type { UserRef } from '../../ports/document.repository.port';
import {
  SHARE_LOCALE_VALUES,
  type ShareDocumentWrite,
  type ShareLinkRecord,
  type ShareLinkRepository,
  type ShareLocale,
} from '../../ports/share-link.repository.port';
import type { ShareSecretsPort } from '../../ports/share-secrets.port';

const REQUIRED_KEY = 'validation.required';
const TOO_LONG_KEY = 'validation.tooLong';
const INVALID_OPTION_KEY = 'validation.invalidOption';
const INVALID_DATE_KEY = 'validation.date.invalid';

export const MAX_SHARE_DOCUMENTS = 50;
export const MAX_SHARE_TITLE_LENGTH = 200;
export const MAX_SHARE_MESSAGE_LENGTH = 2000;

// ───────────────────────────── Inputs ─────────────────────────────

/** A document inside a link: the latest version (`versionId: null`) or a pinned one, with an optional key. */
export interface ShareDocumentInput {
  readonly documentId: string;
  readonly versionId?: string | null;
  /** When `true` and the document has no key yet, a key is generated and returned once. */
  readonly requiresAccessKey?: boolean;
}

/** The form of `createShareLink` and `updateShareLink` (A5: the edit submits every field). */
export interface ShareLinkFieldsInput {
  readonly title: string;
  readonly message?: string | null;
  readonly clientId?: string | null;
  readonly documents: readonly ShareDocumentInput[];
  readonly allowDownload?: boolean;
  readonly locale?: string;
  /** Last valid day (Caracas); no value = never expires. */
  readonly expiresAt?: DateOnly | null;
}

/**
 * The edit form (A5): the same fields, but an answer that would silently reset the link when left out is
 * mandatory. `expiresAt` and `versionId` take `null` as an answer ("never expires", "follow the latest").
 */
export interface ShareLinkEditInput extends ShareLinkFieldsInput {
  readonly allowDownload: boolean;
  readonly expiresAt: DateOnly | null;
  readonly locale: string;
  readonly message: string | null;
  readonly clientId: string | null;
  readonly documents: readonly {
    readonly documentId: string;
    readonly versionId: string | null;
    readonly requiresAccessKey: boolean;
  }[];
}

/** The form after the shape checks: every default applied, text trimmed. */
export interface ShareLinkFields {
  readonly title: string;
  readonly message: string | null;
  readonly clientId: string | null;
  readonly documents: readonly {
    readonly documentId: string;
    readonly versionId: string | null;
    readonly requiresAccessKey: boolean;
  }[];
  readonly allowDownload: boolean;
  readonly locale: ShareLocale;
  readonly expiresAt: DateOnly | null;
}

// ───────────────────────────── Output models ─────────────────────────────

export interface ShareDocumentView {
  /** `{ type: DOCUMENT, id, code, label (title) }`. */
  readonly document: EntityRef;
  readonly documentStatus: DocumentStatus;
  /** Pinned version; `null` follows the latest. */
  readonly versionId: string | null;
  readonly isLatest: boolean;
  /** The version a visitor currently gets. */
  readonly versionNumber: number | null;
  readonly format: DocumentFormat | null;
  readonly order: number;
  readonly requiresAccessKey: boolean;
  readonly accessKeyUpdatedAt: Date | null;
  readonly counters: ShareCounters;
}

/** A link as the owner sees it. No key and no hash: only whether a key is required. */
export interface ShareLinkDetail {
  readonly id: string;
  /** Part of the public URL; the owner needs it to copy the link and build the QR code. */
  readonly token: string;
  readonly url: string;
  readonly title: string;
  readonly message: string | null;
  readonly client: EntityRef | null;
  readonly locale: ShareLocale;
  readonly allowDownload: boolean;
  readonly expiresAt: DateOnly | null;
  readonly revokedAt: Date | null;
  readonly status: ShareStatus;
  readonly counters: ShareCounters;
  readonly lastAccessedAt: Date | null;
  readonly documents: readonly ShareDocumentView[];
  readonly createdBy: UserRef;
  readonly createdAt: Date;
}

export interface ShareLinkListRow {
  readonly id: string;
  readonly title: string;
  readonly client: EntityRef | null;
  readonly documentCount: number;
  /** Documents of the link that require a key. */
  readonly protectedDocumentCount: number;
  readonly status: ShareStatus;
  readonly expiresAt: DateOnly | null;
  readonly counters: ShareCounters;
  readonly lastAccessedAt: Date | null;
  readonly createdBy: UserRef;
  readonly createdAt: Date;
}

/** A freshly generated key: the only place a clear key appears, in a mutation result. */
export interface GeneratedAccessKey {
  readonly documentId: string;
  readonly accessKey: string;
}

export interface ShareLinkMutationResult {
  readonly share: ShareLinkDetail;
  readonly generatedKeys: readonly GeneratedAccessKey[];
}

/** A key and its scrypt hash, made before the unit of work opens (A1). */
export interface PreparedKey {
  readonly accessKey: string;
  readonly hash: string;
}

/** `<APP_URL>/s/<token>` (`APP_URL` without a trailing slash). */
export function shareUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, '')}/s/${token}`;
}

// ───────────────────────────── Support ─────────────────────────────

/**
 * What every share-link use case shares (C11, C12, C14, C20, C22): input normalisation, the reference
 * checks, the link lock, the key preparation and the activity entry. Every method that writes is valid only
 * inside the caller's unit of work. Scrypt never runs inside one (A1): keys are prepared first.
 */
export class ShareSupport {
  constructor(
    readonly shares: ShareLinkRepository,
    private readonly targets: NoteLinkTargetRegistry,
    private readonly secrets: ShareSecretsPort,
    private readonly activityLog: ActivityLogPort,
    private readonly locks: RowLocksPort,
    private readonly clock: ClockPort,
    private readonly ids: IdGeneratorPort,
  ) {}

  now(): Date {
    return this.clock.now();
  }

  /** The Caracas business day. */
  today(): DateOnly {
    return todayInCaracas(this.clock.now());
  }

  nextId(): string {
    return this.ids.next();
  }

  newToken(): string {
    return this.secrets.generateToken();
  }

  /** Takes the `ShareLink` row lock of the unit of work, once and up front (DT-126, DT-146). */
  async lock(shareLinkId: string): Promise<void> {
    await this.locks.lock({ ShareLink: [shareLinkId] });
  }

  async requireLink(id: string): Promise<ShareLinkRecord> {
    const link = await this.shares.findById(id);
    if (!link) throw new NotFoundError();
    return link;
  }

  /** `count` fresh keys, hashed. Call it before the unit of work opens. */
  async prepareKeys(count: number): Promise<PreparedKey[]> {
    return Promise.all(
      Array.from({ length: count }, async () => {
        const accessKey = this.secrets.generateKey();
        return { accessKey, hash: await this.secrets.hashKey(accessKey) };
      }),
    );
  }

  /** One `SHARE_LINK` activity entry. Metadata and changes never carry a key, a hash or the token. */
  async record(
    actor: Actor,
    link: Pick<ShareLinkRecord, 'id' | 'title'>,
    action: 'SHARE_CREATE' | 'SHARE_REVOKE' | 'UPDATE' | 'SYSTEM_JOB',
    extra: {
      readonly changes?: Readonly<Record<string, unknown>>;
      readonly metadata?: Readonly<Record<string, unknown>>;
    } = {},
  ): Promise<void> {
    await this.activityLog.record({
      actor,
      action,
      entityType: 'SHARE_LINK',
      entityId: link.id,
      entityLabel: link.title,
      ...extra,
    });
  }

  /**
   * The shape checks of the form, all in the use case so a caller that skips the DTO meets the same rules
   * (lesson B2): lengths, a distinct non-empty document list, the locale and the expiry date. With
   * `mode: 'edit'` the answers an omission would silently turn into a default (`allowDownload`, `expiresAt`,
   * each document's `versionId` and `requiresAccessKey`, DT-149: `locale`, `message` and `clientId`) are required: a partial PATCH is `VALIDATION`, never
   * a link that lost its key, its pin or its expiry.
   */
  normalize(input: ShareLinkFieldsInput, mode: 'create' | 'edit' = 'create'): ShareLinkFields {
    const errors: FieldErrors = {};
    const fail = (path: string, key: string): void => {
      errors[path] = [key];
    };

    const title = (input.title ?? '').trim();
    if (title === '') fail('title', REQUIRED_KEY);
    else if (title.length > MAX_SHARE_TITLE_LENGTH) fail('title', TOO_LONG_KEY);

    const message = input.message?.trim() ? input.message.trim() : null;
    if (message && message.length > MAX_SHARE_MESSAGE_LENGTH) fail('message', TOO_LONG_KEY);

    const locale = input.locale ?? 'es';
    if (!(SHARE_LOCALE_VALUES as readonly string[]).includes(locale)) {
      fail('locale', INVALID_OPTION_KEY);
    }

    const expiresAt = input.expiresAt ?? null;
    if (expiresAt !== null && !isValidDateOnly(expiresAt)) fail('expiresAt', INVALID_DATE_KEY);

    const documents = input.documents ?? [];
    if (documents.length < 1) fail('documents', REQUIRED_KEY);
    else if (documents.length > MAX_SHARE_DOCUMENTS) fail('documents', TOO_LONG_KEY);
    else if (new Set(documents.map((item) => item.documentId)).size !== documents.length) {
      fail('documents', INVALID_OPTION_KEY);
    }
    documents.forEach((item, index) => {
      if (!item.documentId) fail(`documents.${index}.documentId`, REQUIRED_KEY);
      if (mode === 'edit') {
        if (item.versionId === undefined) fail(`documents.${index}.versionId`, REQUIRED_KEY);
        if (item.requiresAccessKey === undefined) {
          fail(`documents.${index}.requiresAccessKey`, REQUIRED_KEY);
        }
      }
    });
    if (mode === 'edit') {
      if (input.allowDownload === undefined) fail('allowDownload', REQUIRED_KEY);
      if (input.expiresAt === undefined) fail('expiresAt', REQUIRED_KEY);
      if (input.locale === undefined) fail('locale', REQUIRED_KEY);
      if (input.message === undefined) fail('message', REQUIRED_KEY);
      if (input.clientId === undefined) fail('clientId', REQUIRED_KEY);
    }

    if (Object.keys(errors).length > 0) throw new ValidationFailedError({ fieldErrors: errors });
    return {
      title,
      message,
      clientId: input.clientId ? input.clientId : null,
      documents: documents.map((item) => ({
        documentId: item.documentId,
        versionId: item.versionId ?? null,
        requiresAccessKey: item.requiresAccessKey ?? false,
      })),
      allowDownload: input.allowDownload ?? true,
      locale: locale as ShareLocale,
      expiresAt,
    };
  }

  /**
   * Cross-record checks of a create or edit, all before anything is written (`shares.ts:185-213`): the client
   * exists and is live, every document is live and has a version to serve, a pinned version belongs to its
   * document, and the expiry is not in the past (`keepExpiry` lets an edit resubmit the link's current,
   * already passed, date unchanged). Every failure is `VALIDATION` on its field.
   */
  async checkReferences(fields: ShareLinkFields, keepExpiry: DateOnly | null): Promise<void> {
    const errors: FieldErrors = {};
    const fail = (path: string, key: string): void => {
      errors[path] = [key];
    };

    if (fields.clientId) {
      const resolved = await this.targets.resolve([
        { entityType: 'CLIENT', entityId: fields.clientId },
      ]);
      const client = resolved.get(`CLIENT:${fields.clientId}`);
      if (!client || client.archived) fail('clientId', INVALID_OPTION_KEY);
    }

    const documents = await this.shares.sharableDocuments(
      fields.documents.map((item) => item.documentId),
    );
    const owners = await this.shares.versionOwners(
      fields.documents.flatMap((item) => (item.versionId ? [item.versionId] : [])),
    );
    fields.documents.forEach((item, index) => {
      const doc = documents.get(item.documentId);
      if (!doc || doc.archived) {
        fail(`documents.${index}.documentId`, INVALID_OPTION_KEY);
        return;
      }
      if (item.versionId !== null) {
        if (owners.get(item.versionId) !== doc.id) {
          fail(`documents.${index}.versionId`, INVALID_OPTION_KEY);
        }
      } else if (doc.currentVersionId === null) {
        // A draft without a published version has nothing to show in the portal.
        fail(`documents.${index}.documentId`, INVALID_OPTION_KEY);
      }
    });

    if (fields.expiresAt && fields.expiresAt < this.today() && fields.expiresAt !== keepExpiry) {
      fail('expiresAt', INVALID_DATE_KEY);
    }
    if (Object.keys(errors).length > 0) throw new ValidationFailedError({ fieldErrors: errors });
  }
}

// ───────────────────────────── Views ─────────────────────────────

/** Builds the output models of the read use cases and of the mutation results. */
export class ShareViews {
  constructor(
    private readonly shares: ShareLinkRepository,
    private readonly targets: NoteLinkTargetRegistry,
    private readonly appUrl: string,
    private readonly clock: ClockPort,
  ) {}

  private status(link: ShareLinkRecord): ShareStatus {
    return shareStatusOn(link, todayInCaracas(this.clock.now()));
  }

  /** The client labels of `clientIds`, archived clients included (an old link keeps its header). */
  private async clientRefs(clientIds: readonly (string | null)[]): Promise<Map<string, EntityRef>> {
    const ids = [...new Set(clientIds.filter((id): id is string => id !== null))];
    if (ids.length === 0) return new Map();
    const resolved = await this.targets.resolve(
      ids.map((entityId) => ({ entityType: 'CLIENT' as const, entityId })),
    );
    return new Map(
      ids.flatMap((id) => {
        const found = resolved.get(`CLIENT:${id}`);
        return found ? [[id, found.ref] as const] : [];
      }),
    );
  }

  async detail(id: string): Promise<ShareLinkDetail> {
    const link = await this.shares.findById(id);
    if (!link) throw new NotFoundError();
    return (await this.details([link]))[0] as ShareLinkDetail;
  }

  async details(links: readonly ShareLinkRecord[]): Promise<ShareLinkDetail[]> {
    const relations = await this.shares.relationsOf(links.map((link) => link.id));
    const clients = await this.clientRefs(links.map((link) => link.clientId));
    return links.map((link) => {
      const rel = relations.get(link.id);
      const documents = (rel?.documents ?? []).map((item): ShareDocumentView => {
        const servedId = item.versionId ?? item.document.currentVersionId;
        return {
          document: {
            type: 'DOCUMENT',
            id: item.document.id,
            code: item.document.code,
            label: item.document.title,
          },
          documentStatus: item.document.status,
          versionId: item.versionId,
          isLatest: servedId !== null && servedId === item.document.currentVersionId,
          versionNumber: item.served?.versionNumber ?? null,
          format: item.served?.format ?? null,
          order: item.order,
          requiresAccessKey: item.hasAccessKey,
          accessKeyUpdatedAt: item.hasAccessKey ? item.accessKeyUpdatedAt : null,
          counters: item.counters,
        };
      });
      return {
        id: link.id,
        token: link.token,
        url: shareUrl(this.appUrl, link.token),
        title: link.title,
        message: link.message,
        client: link.clientId ? (clients.get(link.clientId) ?? null) : null,
        locale: link.locale,
        allowDownload: link.allowDownload,
        expiresAt: link.expiresAt,
        revokedAt: link.revokedAt,
        status: this.status(link),
        counters: {
          viewCount: link.viewCount,
          downloadCount: link.downloadCount,
          unlockCount: rel?.unlockCount ?? 0,
          failedUnlockCount: rel?.failedUnlockCount ?? 0,
        },
        lastAccessedAt: link.lastAccessedAt,
        documents,
        createdBy: rel?.createdBy ?? { id: link.createdById, name: '', imageUrl: null },
        createdAt: link.createdAt,
      };
    });
  }

  async rows(links: readonly ShareLinkRecord[]): Promise<ShareLinkListRow[]> {
    return (await this.details(links)).map((detail) => ({
      id: detail.id,
      title: detail.title,
      client: detail.client,
      documentCount: detail.documents.length,
      protectedDocumentCount: detail.documents.filter((doc) => doc.requiresAccessKey).length,
      status: detail.status,
      expiresAt: detail.expiresAt,
      counters: detail.counters,
      lastAccessedAt: detail.lastAccessedAt,
      createdBy: detail.createdBy,
      createdAt: detail.createdAt,
    }));
  }
}

/** Display order of a form: the array order. */
export function writesOf(
  fields: ShareLinkFields,
  keyOf: (item: ShareLinkFields['documents'][number]) => ShareDocumentWrite['key'],
): ShareDocumentWrite[] {
  return fields.documents.map((item, order) => ({
    documentId: item.documentId,
    versionId: item.versionId,
    order,
    key: keyOf(item),
  }));
}
