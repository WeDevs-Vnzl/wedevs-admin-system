import type { DocumentType } from '../../domain/document-type';

/** DI token of the type repository; bound to its Prisma adapter in `document-types.module.ts` only. */
export const DOCUMENT_TYPE_REPOSITORY = Symbol('DOCUMENT_TYPE_REPOSITORY');

/**
 * Document types, through the current unit of work. Writes are valid only inside `UnitOfWorkPort.run`.
 * Types are catalog rows: a delete is a real delete, and only when no document uses the type (C19).
 */
export interface DocumentTypeRepository {
  list(): Promise<DocumentType[]>;
  find(id: string): Promise<DocumentType | null>;
  insert(type: DocumentType): Promise<void>;
  update(type: DocumentType): Promise<void>;
  delete(id: string): Promise<void>;
}
