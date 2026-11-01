import { actorOf } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import { diffFields } from '../../../../../shared/domain/activity-diff';
import { ConflictError, IntegrityLockedError } from '../../../../../shared/domain/domain-error';
import type { ShareDocumentLink } from '../../ports/share-link.repository.port';
import {
  writesOf,
  type PreparedKey,
  type ShareLinkFields,
  type ShareLinkEditInput,
  type ShareLinkMutationResult,
  type ShareSupport,
  type ShareViews,
} from './share-support';

export interface UpdateShareLinkInput extends ShareLinkEditInput {
  readonly id: string;
}

/** Fields of the edit form compared for the activity diff (the message is long text: "changed" only). */
const DIFF_FIELDS = ['title', 'message', 'clientId', 'allowDownload', 'locale', 'expiresAt'];

const keyedIds = (documents: readonly ShareDocumentLink[]): Set<string> =>
  new Set(documents.filter((item) => item.hasAccessKey).map((item) => item.documentId));

/** Documents of the form that ask for a key and have none yet. */
const needingKey = (fields: ShareLinkFields, keyed: ReadonlySet<string>): string[] =>
  fields.documents
    .filter((item) => item.requiresAccessKey && !keyed.has(item.documentId))
    .map((item) => item.documentId);

const listOf = (documents: readonly { documentId: string; versionId: string | null }[]): string =>
  JSON.stringify(documents.map((item) => [item.documentId, item.versionId]));

/**
 * `updateShareLink` (`PATCH /share-links/{id}`, A5 and A6): the edit form submits every field and `documents`
 * replaces the document list (add, remove, re-pin). A document that has a key keeps it; `requiresAccessKey`
 * on one without generates a key (returned once); `false` on a keyed one removes it. A revoked link is
 * `INTEGRITY_LOCK`. A new expiry date clears `expiredAt`, so the renewed link is marked again when it next
 * expires. The new keys are hashed before the unit of work; inside it the row lock and a recheck decide, and a
 * list that needs a key nobody prepared (a concurrent edit changed it) is `CONFLICT`. `Serializable`.
 * Records `UPDATE` with the diff; a key change is only ever `accessKey: "changed"` (Δ2).
 */
export class UpdateShareLink {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly support: ShareSupport,
    private readonly views: ShareViews,
  ) {}

  async execute(actor: CurrentUser, input: UpdateShareLinkInput): Promise<ShareLinkMutationResult> {
    assertCan(this.authorization, actor, 'update', 'share');
    const fields = this.support.normalize(input, 'edit');

    // Plan outside the unit of work: which keys to make. The locked recheck below is authoritative.
    const link = await this.support.requireLink(input.id);
    if (link.revokedAt) throw new IntegrityLockedError();
    const planned = needingKey(fields, keyedIds(await this.support.shares.documentsOf(input.id)));
    const keys = await this.support.prepareKeys(planned.length);
    const prepared = new Map<string, PreparedKey>(
      planned.flatMap((id, index) => {
        const key = keys[index];
        return key ? [[id, key] as const] : [];
      }),
    );

    const generated = await this.uow.run(
      async () => {
        await this.support.lock(input.id);
        const current = await this.support.requireLink(input.id);
        if (current.revokedAt) throw new IntegrityLockedError();
        await this.support.checkReferences(fields, current.expiresAt);

        const previous = await this.support.shares.documentsOf(input.id);
        const keyed = keyedIds(previous);
        const generate = needingKey(fields, keyed).map((documentId) => {
          const key = prepared.get(documentId);
          if (!key) throw new ConflictError();
          return { documentId, key };
        });

        const now = this.support.now();
        let keysChanged = previous.some(
          (item) =>
            item.hasAccessKey &&
            !fields.documents.some((next) => next.documentId === item.documentId),
        );
        const writes = writesOf(fields, (item) => {
          if (item.requiresAccessKey) {
            if (keyed.has(item.documentId)) return { kind: 'keep' };
            const fresh = generate.find((entry) => entry.documentId === item.documentId);
            if (!fresh) throw new ConflictError();
            keysChanged = true;
            return { kind: 'set', hash: fresh.key.hash, updatedAt: now };
          }
          if (keyed.has(item.documentId)) keysChanged = true;
          return { kind: 'clear' };
        });

        await this.support.shares.replaceDocuments(current.id, writes);
        await this.support.shares.update(current.id, {
          title: fields.title,
          message: fields.message,
          clientId: fields.clientId,
          locale: fields.locale,
          allowDownload: fields.allowDownload,
          expiresAt: fields.expiresAt,
          clearExpiredAt: fields.expiresAt !== current.expiresAt,
        });

        const changes: Record<string, unknown> = {
          ...diffFields(
            {
              title: current.title,
              message: current.message,
              clientId: current.clientId,
              allowDownload: current.allowDownload,
              locale: current.locale,
              expiresAt: current.expiresAt,
            },
            {
              title: fields.title,
              message: fields.message,
              clientId: fields.clientId,
              allowDownload: fields.allowDownload,
              locale: fields.locale,
              expiresAt: fields.expiresAt,
            },
            { fields: DIFF_FIELDS, longText: ['message'] },
          ),
          ...(listOf(previous) !== listOf(fields.documents) ? { documents: 'changed' } : {}),
          ...(keysChanged ? { accessKey: 'changed' } : {}),
        };
        if (Object.keys(changes).length > 0) {
          await this.support.record(
            actorOf(actor),
            { id: current.id, title: fields.title },
            'UPDATE',
            {
              changes,
            },
          );
        }
        return generate;
      },
      { isolation: 'Serializable' },
    );

    return {
      share: await this.views.detail(input.id),
      generatedKeys: generated.map((entry) => ({
        documentId: entry.documentId,
        accessKey: entry.key.accessKey,
      })),
    };
  }
}
