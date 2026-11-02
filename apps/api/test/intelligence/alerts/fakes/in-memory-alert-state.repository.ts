import type {
  AlertStateRecord,
  AlertStateRepository,
} from '../../../../src/modules/intelligence/application/ports/alert-state.repository.port';
import type { AlertHiding } from '../../../../src/modules/intelligence/domain/alert-state';
import type { InMemoryUnitOfWork } from '../../../support/fakes/in-memory-unit-of-work';

export class InMemoryAlertStateRepository implements AlertStateRepository {
  readonly rows = new Map<string, AlertStateRecord & { userId: string }>();

  /** With a unit of work, every write must run inside it (the adapter writes through the transaction client). */
  constructor(private readonly uow?: InMemoryUnitOfWork) {}

  private k(userId: string, alertKey: string): string {
    return `${userId}|${alertKey}`;
  }

  listByUser(userId: string, alertKeys: readonly string[]) {
    return Promise.resolve(
      alertKeys.flatMap((key) => {
        const row = this.rows.get(this.k(userId, key));
        return row ? [row] : [];
      }),
    );
  }

  markRead(userId: string, alertKeys: readonly string[], at: Date) {
    this.uow?.assertActive('AlertStateRepository.markRead');
    for (const alertKey of alertKeys) {
      const row = this.rows.get(this.k(userId, alertKey));
      this.rows.set(this.k(userId, alertKey), {
        userId,
        alertKey,
        dismissedAt: row?.dismissedAt ?? null,
        dismissedUntil: row?.dismissedUntil ?? null,
        readAt: row?.readAt ?? at,
      });
    }
    return Promise.resolve();
  }

  hide(userId: string, alertKey: string, hiding: AlertHiding) {
    this.uow?.assertActive('AlertStateRepository.hide');
    const row = this.rows.get(this.k(userId, alertKey));
    this.rows.set(this.k(userId, alertKey), {
      userId,
      alertKey,
      dismissedAt: hiding.dismissedAt,
      dismissedUntil: hiding.dismissedUntil,
      readAt: row?.readAt ?? null,
    });
    return Promise.resolve();
  }

  clearHiding(userId: string, alertKey: string) {
    this.uow?.assertActive('AlertStateRepository.clearHiding');
    const row = this.rows.get(this.k(userId, alertKey));
    if (row)
      this.rows.set(this.k(userId, alertKey), { ...row, dismissedAt: null, dismissedUntil: null });
    return Promise.resolve();
  }
}
