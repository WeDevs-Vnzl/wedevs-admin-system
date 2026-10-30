import type { ClientFinanceDependentsPort } from '../../../../src/modules/commercial/application/ports/client-finance-dependents.port';

/** Answers "open invoices" for the clients listed in `withOpenInvoices`. */
export class FakeClientFinanceDependents implements ClientFinanceDependentsPort {
  readonly withOpenInvoices = new Set<string>();

  async hasOpenInvoices(clientId: string): Promise<boolean> {
    return this.withOpenInvoices.has(clientId);
  }
}
