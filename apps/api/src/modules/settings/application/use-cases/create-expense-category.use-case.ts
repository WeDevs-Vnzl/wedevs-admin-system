import type { CurrentUser } from '../../../../shared/application/current-user';
import { actorOf } from '../../../../shared/application/actor';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { ActivityLogPort } from '../../../../shared/application/ports/activity-log.port';
import type { IdGeneratorPort } from '../../../../shared/application/ports/id-generator.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import {
  assertExpenseCategoryPlacement,
  assertSiblingNameFree,
  expenseCategoryCreationChanges,
  normalizeExpenseCategoryFields,
  type ExpenseCategory,
  type ExpenseCategoryFieldsInput,
} from '../../domain/expense-category';
import type { ExpenseCategoryRepository } from '../ports/expense-category.repository.port';

/**
 * Adds an expense category at the root or as a child of a root (PRD §8.8). Order: `can(create, settings)` →
 * validate → one unit of work that checks the placement (`VALIDATION`) and the sibling name (`CONFLICT`), inserts
 * the row with a generated id and logs one `SETTINGS_CHANGE`.
 */
export class CreateExpenseCategory {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly categories: ExpenseCategoryRepository,
    private readonly ids: IdGeneratorPort,
    private readonly activityLog: ActivityLogPort,
  ) {}

  async execute(actor: CurrentUser, input: ExpenseCategoryFieldsInput): Promise<ExpenseCategory> {
    assertCan(this.authorization, actor, 'create', 'settings');
    const fields = normalizeExpenseCategoryFields(input);

    return this.uow.run(async () => {
      const rows = await this.categories.list();
      assertExpenseCategoryPlacement(rows, null, fields.parentId);
      assertSiblingNameFree(rows, fields.name, fields.parentId);

      const category: ExpenseCategory = { id: this.ids.next(), ...fields };
      await this.categories.insert(category);
      await this.activityLog.record({
        actor: actorOf(actor),
        action: 'SETTINGS_CHANGE',
        entityType: 'SETTING',
        entityId: category.id,
        entityLabel: category.name,
        changes: expenseCategoryCreationChanges(category.name),
      });
      return category;
    });
  }
}
