import { Inject, Injectable } from '@nestjs/common';
import type { DocumentCategoryRepository } from '../application/ports/document-category.repository.port';
import type { DocumentCategory } from '../domain/document-category';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';

interface CategoryRow {
  readonly id: string;
  readonly name: string;
  readonly nameEn: string | null;
  readonly color: string | null;
  readonly order: number;
}

function toCategory(row: CategoryRow): DocumentCategory {
  return { id: row.id, name: row.name, nameEn: row.nameEn, color: row.color, order: row.order };
}

/**
 * `DocumentCategory` rows through the current transaction (or the base client outside a unit of work).
 * Categories have no `deletedAt`: the delete is a real delete, and the use case checks the type lock first.
 */
@Injectable()
export class PrismaDocumentCategoryRepository implements DocumentCategoryRepository {
  constructor(@Inject(TransactionHost) private readonly host: TransactionHost) {}

  async list(): Promise<DocumentCategory[]> {
    const rows = await this.host.db.documentCategory.findMany({
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toCategory);
  }

  async find(id: string): Promise<DocumentCategory | null> {
    const row = await this.host.db.documentCategory.findUnique({ where: { id } });
    return row ? toCategory(row) : null;
  }

  async insert(category: DocumentCategory): Promise<void> {
    await this.host.db.documentCategory.create({
      data: {
        id: category.id,
        name: category.name,
        nameEn: category.nameEn,
        color: category.color,
        order: category.order,
      },
    });
  }

  async update(category: DocumentCategory): Promise<void> {
    await this.host.db.documentCategory.update({
      where: { id: category.id },
      data: {
        name: category.name,
        nameEn: category.nameEn,
        color: category.color,
        order: category.order,
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.host.db.documentCategory.delete({ where: { id } });
  }
}
