import { actorOf } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import { diffFields } from '../../../../../shared/domain/activity-diff';
import type { DateOnly } from '../../../../../shared/domain/business-date';
import { NotFoundError, ValidationFailedError } from '../../../../../shared/domain/domain-error';
import type { TagAssignments } from '../../../../settings/application/tag-assignments';
import {
  assertDocumentDates,
  assertDocumentTypeRules,
  documentTypeRuleIssues,
} from '../../../domain';
import {
  documentTagTarget,
  type DocumentDetail,
  type DocumentSupport,
  type DocumentViews,
} from '../../document-support';

const REQUIRED_KEY = 'validation.required';

const DIFF_FIELDS = [
  'title',
  'typeId',
  'summary',
  'effectiveDate',
  'signedAt',
  'expiresAt',
  'alertDaysBefore',
  'tagIds',
] as const;

export interface UpdateDocumentMetaInput {
  readonly id: string;
  readonly title: string;
  readonly typeId: string;
  readonly summary?: string | null;
  readonly effectiveDate?: DateOnly | null;
  readonly signedAt?: DateOnly | null;
  readonly expiresAt?: DateOnly | null;
  readonly alertDaysBefore: number;
  readonly tagIds: readonly string[];
}

/**
 * `updateDocumentMeta` (`PATCH /documents/{id}`): the metadata of a live document; status, links and content
 * have their own use cases. The rules are those of creation for the (possibly new) type plus the document's
 * current status: a `FIRMADO` one cannot move to a type without signature nor lose its signature date.
 * `Serializable` under the `Document` row lock. Logs `UPDATE` with the changed fields, and only when
 * something changed.
 */
export class UpdateDocumentMeta {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly support: DocumentSupport,
    private readonly tags: TagAssignments,
    private readonly views: DocumentViews,
  ) {}

  async execute(actor: CurrentUser, input: UpdateDocumentMetaInput): Promise<DocumentDetail> {
    assertCan(this.authorization, actor, 'update', 'document');
    const title = input.title.trim();
    if (title === '') {
      throw new ValidationFailedError({ fieldErrors: { title: [REQUIRED_KEY] } });
    }

    await this.uow.run(
      async () => {
        await this.support.lock([input.id]);
        const doc = await this.support.requireLive(input.id);
        const type =
          input.typeId === doc.typeId
            ? await this.support.requireType(doc.typeId)
            : await this.support.requireActiveType(input.typeId);

        assertDocumentTypeRules(type, { signedAt: input.signedAt, expiresAt: input.expiresAt });
        assertDocumentDates({ effectiveDate: input.effectiveDate, expiresAt: input.expiresAt });
        const statusIssue = documentTypeRuleIssues(type, { status: doc.status }).find(
          (issue) => issue.path === 'status',
        );
        if (statusIssue) {
          throw new ValidationFailedError({ fieldErrors: { status: [statusIssue.message] } });
        }
        if (doc.status === 'FIRMADO' && !input.signedAt) {
          throw new ValidationFailedError({ fieldErrors: { signedAt: [REQUIRED_KEY] } });
        }

        const patch = {
          title,
          typeId: type.id,
          summary: input.summary?.trim() ? input.summary.trim() : null,
          effectiveDate: input.effectiveDate ?? null,
          signedAt: input.signedAt ?? null,
          expiresAt: input.expiresAt ?? null,
          alertDaysBefore: input.alertDaysBefore,
        };
        const replaced = await this.tags.replace(actor, documentTagTarget(doc.id), input.tagIds);
        const changes = diffFields(
          { ...doc, tagIds: [...replaced.before].sort() },
          { ...patch, tagIds: [...replaced.after].sort() },
          { fields: DIFF_FIELDS, longText: ['summary'] },
        );
        if (!changes) return;

        await this.support.documents.updateMeta(doc.id, {
          ...patch,
          updatedAt: this.support.now(),
          updatedById: actor.userId,
        });
        const after = await this.support.documents.findById(doc.id);
        await this.support.reindex(after ?? doc);
        await this.support.record(actorOf(actor), after ?? doc, 'UPDATE', { changes });
      },
      { isolation: 'Serializable' },
    );

    const doc = await this.support.documents.findById(input.id);
    if (!doc) throw new NotFoundError();
    return this.views.detail(actor, doc);
  }
}
