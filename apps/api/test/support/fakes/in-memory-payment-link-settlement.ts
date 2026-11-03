import type {
  PaymentLinkSettlementPort,
  ProviderPaymentReferencePort,
} from '../../../src/modules/finance/application/ports/payment-link-settlement.port';
import { compareMoney } from '../../../src/shared/domain/money';
import type { InMemoryUnitOfWork, TransactionParticipant } from './in-memory-unit-of-work';

export interface FakeLink {
  id: string;
  invoiceId: string;
  amount: string;
  status: 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'SETTLED' | 'DEACTIVATED';
  paymentId: string | null;
  settledAt?: string;
}

/** Fake `PaymentLinkSettlementPort` and `ProviderPaymentReferencePort`: rows roll back with the unit of work. */
export class InMemoryPaymentLinkSettlement
  implements PaymentLinkSettlementPort, ProviderPaymentReferencePort, TransactionParticipant
{
  private links = new Map<string, FakeLink>();
  private refs = new Map<string, string>();
  private snapshot: { links: Map<string, FakeLink>; refs: Map<string, string> } | null = null;

  constructor(uow?: InMemoryUnitOfWork) {
    uow?.enlist(this);
  }

  seedLink(link: FakeLink): void {
    this.links.set(link.id, link);
  }

  link(id: string): FakeLink | undefined {
    return this.links.get(id);
  }

  referenceOf(provider: string, externalId: string): string | undefined {
    return this.refs.get(`${provider}:${externalId}`);
  }

  begin(): void {
    this.snapshot = {
      links: new Map([...this.links].map(([k, v]) => [k, { ...v }])),
      refs: new Map(this.refs),
    };
  }

  commit(): void {
    this.snapshot = null;
  }

  rollback(): void {
    if (this.snapshot) {
      this.links = this.snapshot.links;
      this.refs = this.snapshot.refs;
    }
    this.snapshot = null;
  }

  async complete(input: {
    linkId: string;
    invoiceId: string;
    paymentId: string;
  }): Promise<boolean> {
    const link = this.links.get(input.linkId);
    if (!link || link.invoiceId !== input.invoiceId || link.status !== 'ACTIVE') return false;
    link.status = 'COMPLETED';
    link.paymentId = input.paymentId;
    return true;
  }

  async settleOnAllocation(input: {
    paymentId: string;
    invoiceId: string;
    allocatedInvoiceCurrency: string;
    at: string;
  }): Promise<boolean> {
    const link = [...this.links.values()].find(
      (l) =>
        l.paymentId === input.paymentId &&
        l.invoiceId === input.invoiceId &&
        l.status === 'COMPLETED',
    );
    if (!link || compareMoney(input.allocatedInvoiceCurrency, link.amount) < 0) return false;
    link.status = 'SETTLED';
    link.settledAt = input.at;
    return true;
  }

  async settleOnVoid(input: { paymentId: string; at: string }): Promise<boolean> {
    const link = [...this.links.values()].find(
      (l) => l.paymentId === input.paymentId && l.status === 'COMPLETED',
    );
    if (!link) return false;
    link.status = 'SETTLED';
    link.settledAt = input.at;
    return true;
  }

  async unsettleOnDeallocation(input: { paymentId: string; invoiceId: string }): Promise<boolean> {
    const link = [...this.links.values()].find(
      (l) =>
        l.paymentId === input.paymentId &&
        l.invoiceId === input.invoiceId &&
        l.status === 'SETTLED',
    );
    if (!link) return false;
    link.status = 'COMPLETED';
    delete link.settledAt;
    return true;
  }

  async findPaymentId(provider: string, externalId: string): Promise<string | null> {
    return this.refs.get(`${provider}:${externalId}`) ?? null;
  }

  async stamp(paymentId: string, provider: string, externalId: string): Promise<void> {
    this.refs.set(`${provider}:${externalId}`, paymentId);
  }
}
