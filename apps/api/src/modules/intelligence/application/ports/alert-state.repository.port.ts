import type { AlertHiding } from '../../domain/alert-state';

export const ALERT_STATE_REPOSITORY = Symbol('ALERT_STATE_REPOSITORY');

/** One `AlertState` row of the caller. */
export interface AlertStateRecord extends AlertHiding {
  readonly alertKey: string;
  readonly readAt: Date | null;
}

/**
 * The caller's own alert state (DT-79, DT-101, DT-163). Every method is scoped by `userId` and each write is
 * one atomic statement on `(userId, alertKey)`, so concurrent calls on one key neither duplicate the row nor
 * lose each other's column. Own rows write no activity (per-user state, like preferences).
 */
export interface AlertStateRepository {
  /** The caller's rows for `alertKeys`. */
  listByUser(userId: string, alertKeys: readonly string[]): Promise<AlertStateRecord[]>;
  /** Marks read, keeping an earlier `readAt`; creates the missing rows. Idempotent. */
  markRead(userId: string, alertKeys: readonly string[], at: Date): Promise<void>;
  /** Hides the alert (forever or until a date) and clears the other column; keeps `readAt`. */
  hide(userId: string, alertKey: string, hiding: AlertHiding, at: Date): Promise<void>;
  /** Clears both hiding columns, keeps `readAt`. No row, no-op. */
  clearHiding(userId: string, alertKey: string): Promise<void>;
}
