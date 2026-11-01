import { actorOf } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { SequencePort } from '../../../../../shared/application/ports/sequence.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import type { DateOnly } from '../../../../../shared/domain/business-date';
import { NotFoundError, ValidationFailedError } from '../../../../../shared/domain/domain-error';
import type { TagAssignments } from '../../../../settings/application/tag-assignments';
import { assertDocumentDates, assertDocumentTypeRules } from '../../../domain';
import {
  assertDistinctTargets,
  documentTagTarget,
  MAX_DOCUMENT_LINKS,
  type DocumentDetail,
  type DocumentSupport,
  type DocumentViews,
  type NewVersionInput,
} from '../../document-support';
import type { DocumentLinkTarget } from '../../ports/document.repository.port';

const REQUIRED_KEY = 'validation.required';

export interface CreateDocumentInput {
  readonly title: string;
  readonly typeId: string;
  readonly summary?: string | null;
  readonly effectiveDate?: DateOnly | null;
  readonly signedAt?: DateOnly | null;
  readonly expiresAt?: DateOnly | null;
  readonly alertDaysBefore: number;
  readonly tagIds: readonly string[];
  readonly links: readonly DocumentLinkTarget[];
  /** Version 1, given with the metadata so a document with a file or link is created all or nothing. */
  readonly initialVersion?: NewVersionInput;
}

/**
 * `createDocument` (`POST /documents`, HU-19, HU-20). Order: `can(create, document)` → active type and its
 * rules (signature date and expiry only where the type has them, expiry not before the effective date) →
 * link targets (readable by the caller, live) → one `Serializable` unit of work: the initial file or URL is
 * checked and its `File` row locked first, the `DOC` code is allocated, the `BORRADOR` row, its tags, links
 * and optional version 1 are written, the search entry is upserted and `CREATE`, one `LINK` per target and the
 * version entry are recorded. Any failure leaves no document, code, link or entry behind.
 */
export class CreateDocument {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly support: DocumentSupport,
    private readonly tags: TagAssignments,
    private readonly sequence: SequencePort,
    private readonly views: DocumentViews,
  ) {}

  async execute(actor: CurrentUser, input: CreateDocumentInput): Promise<DocumentDetail> {
    assertCan(this.authorization, actor, 'create', 'document');

    const title = input.title.trim();
    if (title === '') {
      throw new ValidationFailedError({ fieldErrors: { title: [REQUIRED_KEY] } });
    }

    const id = await this.uow.run(
      async () => {
        // Inside the unit of work, so a `Serializable` retry reads the type again: a type deleted while the
        // first attempt ran answers `NOT_FOUND` instead of inserting against a vanished row.
        const type = await this.support.requireActiveType(input.typeId);
        assertDocumentTypeRules(type, { signedAt: input.signedAt, expiresAt: input.expiresAt });
        assertDocumentDates({ effectiveDate: input.effectiveDate, expiresAt: input.expiresAt });
        if (input.links.length > MAX_DOCUMENT_LINKS) {
          throw new ValidationFailedError({ fieldErrors: { links: ['validation.invalidOption'] } });
        }
        assertDistinctTargets(input.links);
        const refs = await this.support.requireLinkTargets(
          actor,
          input.links,
          (index) => `links.${index}.entityType`,
        );
        const version = input.initialVersion
          ? await this.support.prepareVersion(actor, input.initialVersion)
          : null;

        const now = this.support.now();
        const documentId = this.support.nextId();
        await this.support.documents.insert({
          id: documentId,
          code: await this.sequence.next('DOC'),
          title,
          typeId: type.id,
          summary: input.summary?.trim() ? input.summary.trim() : null,
          status: 'BORRADOR',
          draftContent: null,
          draftUpdatedAt: null,
          currentVersionId: null,
          effectiveDate: input.effectiveDate ?? null,
          signedAt: input.signedAt ?? null,
          expiresAt: input.expiresAt ?? null,
          alertDaysBefore: input.alertDaysBefore,
          createdAt: now,
          createdById: actor.userId,
        });
        await this.tags.replace(actor, documentTagTarget(documentId), input.tagIds);
        // One millisecond apart, so the order of the links (the first client is the activity scope) is exact.
        for (const [index, target] of input.links.entries()) {
          await this.support.documents.addLink(documentId, target, {
            id: this.support.nextId(),
            createdAt: new Date(now.getTime() + index),
            createdById: actor.userId,
          });
        }
        const created = await this.support.documents.findById(documentId);
        if (!created) throw new Error(`Document ${documentId} vanished inside its own transaction`);
        await this.support.reindex(created);

        await this.support.record(actorOf(actor), created, 'CREATE', {}, input.links);
        for (const ref of refs) {
          await this.support.record(
            actorOf(actor),
            created,
            'LINK',
            { metadata: { entityType: ref.type, entityId: ref.id } },
            input.links,
          );
        }
        if (version) {
          await this.support.appendVersion(
            actor,
            created,
            version,
            input.initialVersion?.changelog ?? null,
          );
        }
        return documentId;
      },
      { isolation: 'Serializable' },
    );

    const created = await this.support.documents.findById(id);
    if (!created) throw new NotFoundError();
    return this.views.detail(actor, created);
  }
}
