export const CLIENT_FINANCE_DEPENDENTS = Symbol('CLIENT_FINANCE_DEPENDENTS');

/**
 * What the client archive lock needs to know from `finance` (Q-BE2-1). `commercial` declares the narrow
 * question it asks; BE-2 binds a neutral answer ("no dependents": no BE write path for invoices exists
 * yet) and BE-3 rebinds it to the finance application API.
 */
export interface ClientFinanceDependentsPort {
  /** Whether the client has an invoice with a balance still to collect (`EMITIDA|PARCIAL|VENCIDA`). */
  hasOpenInvoices(clientId: string): Promise<boolean>;
}
