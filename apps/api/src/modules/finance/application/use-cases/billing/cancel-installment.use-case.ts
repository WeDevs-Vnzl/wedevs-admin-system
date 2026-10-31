import { actorOf } from '../../../../../shared/application/actor';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import {
  ConflictError,
  IntegrityLockedError,
  NotFoundError,
} from '../../../../../shared/domain/domain-error';
import type { BillingRepository } from '../../ports/billing.repository.port';
import { BILLING_ERRORS, loadPage, type BillingPageView } from './billing-support';
import type { BillingTransaction } from './billing-transaction';

/**
 * `POST /installments/{id}/cancel` (HU-09 CA3, C19): cancels an installment that no live invoice references;
 * it stays in the list as cancelled. The installment row is locked before it is read.
 */
export class CancelInstallment {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly tx: BillingTransaction,
    private readonly repository: BillingRepository,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: CurrentUser, id: string): Promise<BillingPageView> {
    assertCan(this.authorization, actor, 'update', 'billing');
    const stored = await this.repository.findInstallment(id);
    if (stored === null) throw new NotFoundError();

    return this.tx.run(
      actorOf(actor),
      stored.projectId,
      { BillingInstallment: [id] },
      async (project) => {
        const row = await this.repository.findInstallment(id);
        if (row === null || row.projectId !== project.id) throw new NotFoundError();
        if (row.cancelledAt !== null) {
          throw new ConflictError({ message: BILLING_ERRORS.installmentCancelled });
        }
        if (row.locked)
          throw new IntegrityLockedError({ message: BILLING_ERRORS.installmentBilled });
        await this.repository.cancelInstallments([id], this.clock.now());
        return {
          value: await loadPage(this.repository, project.id),
          changed: true,
          activity: [
            {
              action: 'STATUS_CHANGE',
              entityType: 'INSTALLMENT',
              entityId: id,
              entityLabel: row.label,
              changes: { status: [row.status, 'CANCELADA'] },
              metadata: { projectId: project.id },
            },
          ],
        };
      },
    );
  }
}
