import type { DocumentCategory } from '../../domain/document-category';

/** DI token of the category repository; bound to its Prisma adapter in `document-types.module.ts` only. */
export const DOCUMENT_CATEGORY_REPOSITORY = Symbol('DOCUMENT_CATEGORY_REPOSITORY');

/**
 * Document categories, through the current unit of work. Writes are valid only inside `UnitOfWorkPort.run`.
 * Categories are catalog rows: a delete is a real delete (no `deletedAt`, data-rules.md §6).
 */
export interface DocumentCategoryRepository {
  /** Every category, ascending by `order`. */
  list(): Promise<DocumentCategory[]>;
  find(id: string): Promise<DocumentCategory | null>;
  insert(category: DocumentCategory): Promise<void>;
  update(category: DocumentCategory): Promise<void>;
  delete(id: string): Promise<void>;
}
