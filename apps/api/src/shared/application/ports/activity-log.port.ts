import type { ActivityAction, EntityType } from '../../domain/enums';
import type { Actor } from '../actor';

/** One `ActivityLog` row (PRD §10.2). `clientId` is the Δ12 denormalized client scope. */
export interface ActivityEntry {
  readonly actor: Actor;
  readonly action: ActivityAction;
  readonly entityType: EntityType;
  readonly entityId: string;
  readonly entityLabel: string;
  readonly clientId?: string | null;
  /**
   * Every client whose `lastActivityAt` the entry bumps, for entities linked to several clients (Q-BE2-2).
   * `clientId` stays the single denormalized scope (the earliest link); when omitted, only `clientId` is bumped.
   */
  readonly touchClientIds?: readonly string[];
  readonly changes?: Readonly<Record<string, unknown>> | null;
  readonly metadata?: Readonly<Record<string, unknown>> | null;
  /** For `USER` entries left unset, the writer fills `ip` and `userAgent` from the request context. */
  readonly ip?: string | null;
  readonly userAgent?: string | null;
}

/** Writes an activity entry in the current transaction. Valid only inside `UnitOfWorkPort.run`. */
export interface ActivityLogPort {
  record(entry: ActivityEntry): Promise<void>;
}
