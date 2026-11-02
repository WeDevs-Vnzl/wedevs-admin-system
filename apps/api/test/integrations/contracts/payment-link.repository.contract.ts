import { describe, expect, it } from 'vitest';
import type { PaymentLinkRepository } from '../../../src/modules/integrations/application/ports/payment-link.repository.port';
import {
  activateLink,
  deactivateLink,
  type PaymentLink,
} from '../../../src/modules/integrations/domain/payment-link';

export interface PaymentLinkRepositoryHarness {
  readonly repository: PaymentLinkRepository;
}

const link = (id: string, invoiceId: string, createdAt: string): PaymentLink => ({
  id,
  invoiceId,
  requestId: `req-${id}`,
  provider: 'STRIPE',
  externalId: null,
  url: null,
  amount: '10.00',
  currency: 'USD',
  status: 'PENDING',
  paymentId: null,
  deactivationReason: null,
  createdAt: new Date(createdAt),
  createdById: 'user-1',
  deactivatedAt: null,
  settledAt: null,
});

/** Contract of `PaymentLinkRepository` (DT-196). */
export function paymentLinkRepositoryContract(
  name: string,
  factory: () => Promise<PaymentLinkRepositoryHarness> | PaymentLinkRepositoryHarness,
): void {
  describe(`PaymentLinkRepository contract: ${name}`, () => {
    it('saves and finds a link by id, request id and external id', async () => {
      const { repository } = await factory();
      const active = activateLink(link('l1', 'inv-1', '2026-11-02T10:00:00Z'), {
        externalId: 'plink_1',
        url: 'https://pay.example.test/1',
      });
      await repository.save(active);
      expect(await repository.findById('l1')).toEqual(active);
      expect(await repository.findByRequestId('inv-1', 'req-l1')).toEqual(active);
      expect(await repository.findByExternalId('plink_1')).toEqual(active);
    });

    it('scopes the request id to its invoice', async () => {
      const { repository } = await factory();
      await repository.save(link('l1', 'inv-1', '2026-11-02T10:00:00Z'));
      expect(await repository.findByRequestId('inv-2', 'req-l1')).toBeNull();
    });

    it('replaces a stored link when saved again', async () => {
      const { repository } = await factory();
      const pending = link('l1', 'inv-1', '2026-11-02T10:00:00Z');
      await repository.save(pending);
      const off = deactivateLink(pending, 'BALANCE_SHRUNK', new Date('2026-11-02T11:00:00Z'));
      await repository.save(off);
      expect((await repository.findById('l1'))?.status).toBe('DEACTIVATED');
    });

    it('lists the links of one invoice newest first, several per invoice', async () => {
      const { repository } = await factory();
      await repository.save(link('a', 'inv-1', '2026-11-02T08:00:00Z'));
      await repository.save(link('c', 'inv-1', '2026-11-02T10:00:00Z'));
      await repository.save(link('b', 'inv-1', '2026-11-02T09:00:00Z'));
      await repository.save(link('x', 'inv-2', '2026-11-02T11:00:00Z'));
      const ids = (await repository.listByInvoice('inv-1')).map((l) => l.id);
      expect(ids).toEqual(['c', 'b', 'a']);
    });

    it('lists the invoices that still hold an open link', async () => {
      const { repository } = await factory();
      await repository.save(link('a', 'inv-1', '2026-11-02T08:00:00Z'));
      await repository.save(
        deactivateLink(
          link('b', 'inv-2', '2026-11-02T08:00:00Z'),
          'X',
          new Date('2026-11-02T09:00:00Z'),
        ),
      );
      expect(await repository.listInvoiceIdsWithOpenLinks()).toEqual(['inv-1']);
    });

    it('returns null for unknown ids', async () => {
      const { repository } = await factory();
      expect(await repository.findById('nope')).toBeNull();
      expect(await repository.findByExternalId('nope')).toBeNull();
    });
  });
}
