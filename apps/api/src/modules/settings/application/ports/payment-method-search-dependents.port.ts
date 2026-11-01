export const PAYMENT_METHOD_SEARCH_DEPENDENTS = Symbol('PAYMENT_METHOD_SEARCH_DEPENDENTS');

/**
 * Rewrites the payment-method name that payment `SearchEntry` rows carry (DT-166, A15). Valid only inside
 * the caller's `Serializable` unit of work, with database effects only (the unit of work may retry it).
 */
export interface PaymentMethodSearchDependentsPort {
  /** Sets the method name on every dependant entry (archived rows included); returns the rows changed. */
  relabelMethod(methodId: string, name: string): Promise<number>;
}
