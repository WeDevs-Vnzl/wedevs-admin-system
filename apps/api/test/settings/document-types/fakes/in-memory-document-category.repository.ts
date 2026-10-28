import type { DocumentCategoryRepository } from '../../../../src/modules/settings/application/ports/document-category.repository.port';
import type { DocumentCategory } from '../../../../src/modules/settings/domain/document-category';
import type {
  InMemoryUnitOfWork,
  TransactionParticipant,
} from '../../../support/fakes/in-memory-unit-of-work';

/**
 * Fake `DocumentCategoryRepository`. Writes made inside a unit of work become visible on commit and are
 * discarded on rollback, like the adapter. `writeCount` counts every write, so tests can assert "nothing
 * written".
 */
export class InMemoryDocumentCategoryRepository
  implements DocumentCategoryRepository, TransactionParticipant
{
  private committed = new Map<string, DocumentCategory>();
  private pending = new Map<string, DocumentCategory>();
  writeCount = 0;

  constructor(private readonly uow: InMemoryUnitOfWork) {
    uow.enlist(this);
  }

  /** Committed rows only, ascending by `order`, for assertions after the call returned or threw. */
  get rows(): DocumentCategory[] {
    return [...this.committed.values()]
      .sort((a, b) => a.order - b.order)
      .map((row) => ({ ...row }));
  }

  seed(rows: readonly DocumentCategory[]): void {
    for (const row of rows) this.committed.set(row.id, { ...row });
  }

  private view(): Map<string, DocumentCategory> {
    return this.uow.isActive ? this.pending : this.committed;
  }

  private write(): void {
    this.uow.assertActive('DocumentCategoryRepository write');
    this.writeCount += 1;
  }

  async list(): Promise<DocumentCategory[]> {
    return [...this.view().values()].sort((a, b) => a.order - b.order).map((row) => ({ ...row }));
  }

  async find(id: string): Promise<DocumentCategory | null> {
    const row = this.view().get(id);
    return row ? { ...row } : null;
  }

  async insert(category: DocumentCategory): Promise<void> {
    this.write();
    if (this.pending.has(category.id)) throw new Error(`duplicate category id ${category.id}`);
    this.pending.set(category.id, { ...category });
  }

  async update(category: DocumentCategory): Promise<void> {
    this.write();
    if (!this.pending.has(category.id)) throw new Error(`no category ${category.id}`);
    this.pending.set(category.id, { ...category });
  }

  async delete(id: string): Promise<void> {
    this.write();
    this.pending.delete(id);
  }

  begin(): void {
    this.pending = new Map(this.committed);
  }

  commit(): void {
    this.committed = this.pending;
  }

  rollback(): void {
    this.pending = new Map(this.committed);
  }
}
