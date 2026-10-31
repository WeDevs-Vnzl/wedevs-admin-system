import { describe, expect, it } from 'vitest';
import type { InvoiceRepository } from '../application/ports/invoice.repository.port';
import { FinanceClientDependents } from './client-finance-dependents.adapter';

const repository = (open: readonly string[]) =>
  ({
    openInvoices: async (clientId: string) => open.filter((id) => id === clientId).map(() => ({})),
  }) as unknown as Pick<InvoiceRepository, 'openInvoices'>;

describe('FinanceClientDependents (ClientFinanceDependentsPort over finance)', () => {
  it('is true only for a client with an open invoice', async () => {
    const dependents = new FinanceClientDependents(repository(['cli_a']));
    expect(await dependents.hasOpenInvoices('cli_a')).toBe(true);
    expect(await dependents.hasOpenInvoices('cli_b')).toBe(false);
  });
});
