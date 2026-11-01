import type {
  FileAccessClaim,
  FileAccessResolver,
} from '../../platform/application/ports/file-access.port';
import type {
  TaggableTarget,
  TaggableTargetResolver,
} from '../../settings/application/ports/taggable-target.port';
import type { NoteLinkTargetResolver } from '../../commercial/application/note-link-target.registry';
import type { ResolvedNoteTarget } from '../../commercial/application/ports/note-target.port';
import type { ExpenseRepository } from '../application/ports/expense.repository.port';

/** A receipt downloads with `read` on expenses (C23); an expense is never archived, so any carrier counts. */
export class ExpenseReceiptAccessResolver implements FileAccessResolver {
  constructor(private readonly expenses: ExpenseRepository) {}

  async resolve(fileId: string): Promise<FileAccessClaim | null> {
    return (await this.expenses.hasReceiptFile(fileId))
      ? { kind: 'resource', resource: 'expense' }
      : null;
  }
}

/** Lets settings' tag endpoints tag an expense: `update` on `expense` governs it. */
export class ExpenseTaggableResolver implements TaggableTargetResolver {
  readonly entityType = 'EXPENSE' as const;
  readonly resource = 'expense' as const;

  constructor(private readonly expenses: ExpenseRepository) {}

  async resolve(id: string): Promise<TaggableTarget | null> {
    const label = (await this.expenses.labels([id])).get(id);
    return label ? { label: label.description, clientId: null } : null;
  }
}

/** Lets a note hang from an expense; an expense is never archived (Q-BE3-4). */
export class ExpenseNoteTargetResolver implements NoteLinkTargetResolver {
  readonly entityType = 'EXPENSE' as const;

  constructor(private readonly expenses: ExpenseRepository) {}

  async resolve(ids: readonly string[]): Promise<Map<string, ResolvedNoteTarget>> {
    const labels = await this.expenses.labels(ids);
    return new Map(
      [...labels].map(([id, label]) => [
        id,
        {
          ref: { type: 'EXPENSE' as const, id, code: label.code, label: label.description },
          archived: false,
        },
      ]),
    );
  }
}
