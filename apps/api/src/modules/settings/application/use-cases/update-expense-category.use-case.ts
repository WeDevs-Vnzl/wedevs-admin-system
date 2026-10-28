import type { CurrentUser } from '../../../../shared/application/current-user';
import { actorOf } from '../../../../shared/application/actor';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { ActivityLogPort } from '../../../../shared/application/ports/activity-log.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import { NotFoundError } from '../../../../shared/domain/domain-error';
import {
  assertExpenseCategoryPlacement,
  assertSiblingNameFree,
  expenseCategoryChanges,
  normalizeExpenseCategoryFields,
  type ExpenseCategory,
  type ExpenseCategoryFieldsInput,
} from '../../domain/expense-category';
import type { ExpenseCategoryRepository } from '../ports/expense-category.repository.port';

/**
 * Edits an expense category. Order: `can(update, settings)` → validate (a category cannot be its own parent) →
 * load (`NOT_FOUND`) → one unit of work that checks the placement (a root with children stays a root) and the
 * sibling name, writes and logs `SETTINGS_CHANGE` only when something changed.
 */
export class UpdateExpenseCategory {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly categories: ExpenseCategoryRepository,
    private readonly activityLog: ActivityLogPort,
  ) {}

  async execute(
    actor: CurrentUser,
    id: string,
    input: ExpenseCategoryFieldsInput,
  ): Promise<ExpenseCategory> {
    assertCan(this.authorization, actor, 'update', 'settings');
    const fields = normalizeExpenseCategoryFields(input, id);

    return this.uow.run(async () => {
      const before = await this.categories.findById(id);
      if (!before) throw new NotFoundError();
      const rows = await this.categories.list();
      assertExpenseCategoryPlacement(rows, before, fields.parentId);
      assertSiblingNameFree(rows, fields.name, fields.parentId, id);

      const changes = expenseCategoryChanges(before, fields);
      if (changes === null) return before;

      const after: ExpenseCategory = { id, ...fields };
      await this.categories.update(after);
      await this.activityLog.record({
        actor: actorOf(actor),
        action: 'SETTINGS_CHANGE',
        entityType: 'SETTING',
        entityId: id,
        entityLabel: after.name,
        changes,
      });
      return after;
    });
  }
}
