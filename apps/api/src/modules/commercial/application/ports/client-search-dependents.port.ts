export const CLIENT_SEARCH_DEPENDENTS = Symbol('CLIENT_SEARCH_DEPENDENTS');

/**
 * Rewrites the client label that other contexts' `SearchEntry` rows carry (DT-166, A15). Valid only inside
 * the caller's `Serializable` unit of work, with database effects only (the unit of work may retry it).
 */
export interface ClientSearchDependentsPort {
  /** Sets the client label on every dependant entry (archived rows included); returns the rows changed. */
  relabelClient(clientId: string, label: string): Promise<number>;
}
