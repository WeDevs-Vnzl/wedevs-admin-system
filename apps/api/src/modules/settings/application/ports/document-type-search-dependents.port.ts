export const DOCUMENT_TYPE_SEARCH_DEPENDENTS = Symbol('DOCUMENT_TYPE_SEARCH_DEPENDENTS');

/**
 * Rewrites the document-type name that document `SearchEntry` rows carry (DT-166, A15). Valid only inside
 * the caller's `Serializable` unit of work, with database effects only (the unit of work may retry it).
 */
export interface DocumentTypeSearchDependentsPort {
  /** Sets the type name on every dependant entry (archived rows included); returns the rows changed. */
  relabelType(typeId: string, name: string): Promise<number>;
}
