import type { Actor } from '../../../../shared/application/actor';
import type { ActivityLogPort } from '../../../../shared/application/ports/activity-log.port';
import type { ClockPort } from '../../../../shared/application/ports/clock.port';
import type { IdGeneratorPort } from '../../../../shared/application/ports/id-generator.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import { diffFields } from '../../../../shared/domain/activity-diff';
import { ConflictError } from '../../../../shared/domain/domain-error';
import {
  USER_SYNC_DIFF_FIELDS,
  USER_ERROR_KEYS,
  normalizeEmail,
  resolveInitialRole,
} from '../../domain/user';
import type { UserRepository } from '../ports/user.repository.port';

export const CLERK_USER_EVENT_TYPES = ['user.created', 'user.updated', 'user.deleted'] as const;
export type ClerkUserEventType = (typeof CLERK_USER_EVENT_TYPES)[number];

export interface ClerkUserEvent {
  readonly type: ClerkUserEventType;
  readonly data: Readonly<Record<string, unknown>>;
}

export type SyncOutcome = 'created' | 'updated' | 'deleted' | 'unchanged' | 'ignored';

const SYSTEM: Actor = { actorType: 'SYSTEM', userId: null };

interface ClerkProfile {
  readonly email: string;
  readonly name: string;
  readonly imageUrl: string | null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** Reads the fields the local `User` mirrors from a Clerk `user.*` payload; `null` without a usable e-mail. */
function parseProfile(data: Readonly<Record<string, unknown>>): ClerkProfile | null {
  const addresses = Array.isArray(data.email_addresses) ? (data.email_addresses as unknown[]) : [];
  const entries = addresses.filter(
    (item): item is Record<string, unknown> => typeof item === 'object' && item !== null,
  );
  const primary = entries.find((item) => item.id === data.primary_email_address_id) ?? entries[0];
  const email = text(primary?.email_address);
  if (!email) return null;
  const fullName = [text(data.first_name), text(data.last_name)].filter(Boolean).join(' ');
  const normalized = normalizeEmail(email);
  return {
    email: normalized,
    name: fullName || (normalized.split('@')[0] ?? normalized),
    imageUrl: text(data.image_url),
  };
}

/**
 * Mirrors the Clerk `user.*` webhook events into the local `User` (HU-01, C24). Runs as the `SYSTEM` actor
 * after the signature was verified. Idempotent by construction (Q-BE1-1): `created` never touches an
 * existing row (a deleted user is not resurrected), `updated` rewrites only e-mail, name and image (never
 * the role, C13) and `deleted` is a soft delete of a row that may already be gone.
 */
export class SyncClerkUser {
  constructor(
    private readonly users: UserRepository,
    private readonly uow: UnitOfWorkPort,
    private readonly activity: ActivityLogPort,
    private readonly clock: ClockPort,
    private readonly ids: IdGeneratorPort,
  ) {}

  async execute(event: ClerkUserEvent): Promise<SyncOutcome> {
    const clerkId = text(event.data.id);
    if (!clerkId) return 'ignored';
    switch (event.type) {
      case 'user.created':
        return this.created(clerkId, event.data);
      case 'user.updated':
        return this.updated(clerkId, event.data);
      case 'user.deleted':
        return this.deleted(clerkId);
    }
  }

  private async created(
    clerkId: string,
    data: Readonly<Record<string, unknown>>,
  ): Promise<SyncOutcome> {
    const profile = parseProfile(data);
    if (!profile) return 'ignored';
    const role = resolveInitialRole(data.public_metadata);
    return this.uow.run(async () => {
      if (await this.users.findAnyByClerkId(clerkId)) return 'unchanged';
      await this.assertEmailFree(profile.email, null);
      const user = await this.users.insertIfAbsent({
        id: this.ids.next(),
        clerkId,
        ...profile,
        role,
        now: this.clock.now(),
      });
      // A concurrent delivery of the same event won the race (Svix retries): the work is done.
      if (!user) return 'unchanged';
      await this.activity.record({
        actor: SYSTEM,
        action: 'CREATE',
        entityType: 'USER',
        entityId: user.id,
        entityLabel: user.name,
        metadata: { source: 'clerk', role },
      });
      return 'created';
    });
  }

  private async updated(
    clerkId: string,
    data: Readonly<Record<string, unknown>>,
  ): Promise<SyncOutcome> {
    const profile = parseProfile(data);
    if (!profile) return 'ignored';
    return this.uow.run(async () => {
      const user = await this.users.findActiveByClerkId(clerkId);
      if (!user) return 'ignored';
      const changes = diffFields({ ...user }, { ...profile }, { fields: USER_SYNC_DIFF_FIELDS });
      if (!changes) return 'unchanged';
      await this.assertEmailFree(profile.email, user.id);
      await this.users.updateProfile(user.id, { ...profile, now: this.clock.now() });
      await this.activity.record({
        actor: SYSTEM,
        action: 'UPDATE',
        entityType: 'USER',
        entityId: user.id,
        entityLabel: profile.name,
        changes,
        metadata: { source: 'clerk' },
      });
      return 'updated';
    });
  }

  private async deleted(clerkId: string): Promise<SyncOutcome> {
    return this.uow.run(async () => {
      const user = await this.users.findActiveByClerkId(clerkId);
      if (!user) return 'unchanged';
      await this.users.softDelete(user.id, this.clock.now());
      await this.activity.record({
        actor: SYSTEM,
        action: 'DELETE',
        entityType: 'USER',
        entityId: user.id,
        entityLabel: user.name,
        metadata: { source: 'clerk' },
      });
      return 'deleted';
    });
  }

  /** `User.email` is unique across active and deleted rows; another holder is a conflict, not a crash. */
  private async assertEmailFree(email: string, exceptUserId: string | null): Promise<void> {
    const holder = await this.users.findAnyByEmail(email);
    if (holder && holder.id !== exceptUserId) {
      throw new ConflictError({ fieldErrors: { email: [USER_ERROR_KEYS.emailTaken] } });
    }
  }
}
