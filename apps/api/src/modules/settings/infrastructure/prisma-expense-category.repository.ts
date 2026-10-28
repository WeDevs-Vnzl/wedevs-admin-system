import { Inject, Injectable } from '@nestjs/common';
import type { ExpenseCategoryRepository } from '../application/ports/expense-category.repository.port';
import type { ExpenseCategory } from '../domain/expense-category';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';

/**
 * `ExpenseCategory` rows through the current transaction (or the base client outside a unit of work). The table has
 * no unique index beyond the id, so sibling names are checked by the domain inside the unit of work.
 */
@Injectable()
export class PrismaExpenseCategoryRepository implements ExpenseCategoryRepository {
  constructor(@Inject(TransactionHost) private readonly host: TransactionHost) {}

  async list(): Promise<ExpenseCategory[]> {
    const rows = await this.host.db.expenseCategory.findMany();
    return rows.map(toExpenseCategory);
  }

  async findById(id: string): Promise<ExpenseCategory | null> {
    const row = await this.host.db.expenseCategory.findUnique({ where: { id } });
    return row ? toExpenseCategory(row) : null;
  }

  async insert(category: ExpenseCategory): Promise<void> {
    await this.host.db.expenseCategory.create({
      data: {
        id: category.id,
        name: category.name,
        nameEn: category.nameEn,
        color: category.color,
        parentId: category.parentId,
        active: category.active,
      },
    });
  }

  async update(category: ExpenseCategory): Promise<void> {
    await this.host.db.expenseCategory.update({
      where: { id: category.id },
      data: {
        name: category.name,
        nameEn: category.nameEn,
        color: category.color,
        parentId: category.parentId,
        active: category.active,
      },
    });
  }
}

function toExpenseCategory(row: {
  id: string;
  name: string;
  nameEn: string | null;
  color: string | null;
  parentId: string | null;
  active: boolean;
}): ExpenseCategory {
  return {
    id: row.id,
    name: row.name,
    nameEn: row.nameEn,
    color: row.color,
    parentId: row.parentId,
    active: row.active,
  };
}
