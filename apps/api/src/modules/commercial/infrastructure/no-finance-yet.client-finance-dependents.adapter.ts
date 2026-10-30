import { Injectable } from '@nestjs/common';
import type { ClientFinanceDependentsPort } from '../application/ports/client-finance-dependents.port';

/**
 * Neutral binding of `ClientFinanceDependentsPort` until BE-3 (Q-BE2-1). Correct today because no BE
 * write path for invoices exists and the seed has no business data; BE-3 rebinds it to `finance`.
 */
@Injectable()
export class NoFinanceYetClientFinanceDependents implements ClientFinanceDependentsPort {
  hasOpenInvoices(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
