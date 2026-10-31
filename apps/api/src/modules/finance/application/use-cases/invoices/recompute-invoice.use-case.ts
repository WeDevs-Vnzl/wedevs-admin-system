import { NotFoundError } from '../../../../../shared/domain/domain-error';
import { compareMoney } from '../../../../../shared/domain/money';
import type { InvoiceRecord } from '../../ports/invoice.repository.port';
import type { InvoiceSupport } from './invoice-support';

/**
 * The record with its tax lines in the order the repository reads them (highest rate first). The domain
 * emits them in line order, so comparing the raw records would see a difference on a multi-rate invoice.
 */
const normalized = (record: InvoiceRecord): InvoiceRecord => ({
  ...record,
  taxLines: [...record.taxLines].sort((a, b) => compareMoney(b.ivaRate, a.ivaRate)),
});

/**
 * `recomputeInvoice` (PRD §12, C17, C18): rewrites the cached columns of an invoice (totals, `paidAmount`,
 * `balance`, `status`) from its lines, its valid manual adjustments and its live allocations, through the same
 * domain functions every mutation uses. Exported for payments: they call it with the invoices they touch,
 * inside their own `Serializable` unit of work and after they took their locks (`Invoice` follows
 * `BillingInstallment` in the global order); it never opens an isolation, never locks and projects nothing,
 * because the caller projects what its own mutation changed. Writes only when something changed and returns
 * the stored row.
 */
export class RecomputeInvoice {
  constructor(private readonly support: InvoiceSupport) {}

  async execute(invoiceId: string): Promise<InvoiceRecord> {
    const before = await this.support.invoices.findById(invoiceId);
    if (!before) throw new NotFoundError();
    const derived = await this.support.rederive(before);
    const changed = JSON.stringify(normalized(derived)) !== JSON.stringify(normalized(before));
    if (!changed) return before;

    const after = { ...derived, updatedAt: this.support.nowIso() };
    await this.support.invoices.update(after);
    const installmentIds = [
      ...new Set(after.lines.flatMap((line) => (line.installmentId ? [line.installmentId] : []))),
    ];
    if (installmentIds.length > 0) await this.support.recomputeInstallments(installmentIds);
    return after;
  }
}
