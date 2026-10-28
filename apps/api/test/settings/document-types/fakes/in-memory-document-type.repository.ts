import type { DocumentTypeRepository } from '../../../../src/modules/settings/application/ports/document-type.repository.port';
import type { DocumentType } from '../../../../src/modules/settings/domain/document-type';
import type {
  InMemoryUnitOfWork,
  TransactionParticipant,
} from '../../../support/fakes/in-memory-unit-of-work';

/**
 * Fake `DocumentTypeRepository`. Writes made inside a unit of work become visible on commit and are
 * discarded on rollback, like the adapter. `writeCount` counts every write, so tests can assert "nothing
 * written".
 */
export class InMemoryDocumentTypeRepository
  implements DocumentTypeRepository, TransactionParticipant
{
  private committed = new Map<string, DocumentType>();
  private pending = new Map<string, DocumentType>();
  writeCount = 0;

  constructor(private readonly uow: InMemoryUnitOfWork) {
    uow.enlist(this);
  }

  /** Committed rows only, for assertions after the call returned or threw. */
  get rows(): DocumentType[] {
    return [...this.committed.values()].map((row) => ({ ...row }));
  }

  seed(rows: readonly DocumentType[]): void {
    for (const row of rows) this.committed.set(row.id, { ...row });
  }

  private view(): Map<string, DocumentType> {
    return this.uow.isActive ? this.pending : this.committed;
  }

  private write(): void {
    this.uow.assertActive('DocumentTypeRepository write');
    this.writeCount += 1;
  }

  async list(): Promise<DocumentType[]> {
    return [...this.view().values()].map((row) => ({ ...row }));
  }

  async find(id: string): Promise<DocumentType | null> {
    const row = this.view().get(id);
    return row ? { ...row } : null;
  }

  async insert(type: DocumentType): Promise<void> {
    this.write();
    if (this.pending.has(type.id)) throw new Error(`duplicate type id ${type.id}`);
    this.pending.set(type.id, { ...type });
  }

  async update(type: DocumentType): Promise<void> {
    this.write();
    if (!this.pending.has(type.id)) throw new Error(`no type ${type.id}`);
    this.pending.set(type.id, { ...type });
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
