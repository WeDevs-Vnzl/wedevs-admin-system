import { describe, expect, it } from 'vitest';
import {
  ConflictError,
  NotFoundError,
  ValidationFailedError,
} from '../../../src/shared/domain/domain-error';
import { createTokenWorld, seedOwner } from './world';

const DAY = 86_400_000;

describe('IssueApiToken', () => {
  it('returns the secret once, stores only its SHA-256 and defaults to 90 days', async () => {
    const w = createTokenWorld();
    const { actor } = seedOwner(w);
    const out = await w.issue.execute(actor, { name: '  Claude Desktop ' });
    expect(out.secret).toMatch(/^wdc_pat_/);
    expect(out.prefix).toBe(out.secret.slice(0, 12));
    expect(out.name).toBe('Claude Desktop');
    expect(out.expiresAt.getTime()).toBe(w.clock.now().getTime() + 90 * DAY);
    const [row] = w.tokens.all();
    expect(row?.tokenHash).toBe(w.secrets.hash(out.secret));
    expect(JSON.stringify(row)).not.toContain(out.secret);
    expect(row?.userId).toBe(actor.userId);
  });

  it('honours expiresInDays between 1 and 365 and rejects the rest', async () => {
    const w = createTokenWorld();
    const { actor } = seedOwner(w);
    const out = await w.issue.execute(actor, { name: 'a', expiresInDays: 365 });
    expect(out.expiresAt.getTime()).toBe(w.clock.now().getTime() + 365 * DAY);
    for (const bad of [0, 366, 1.5, -3, Number.NaN]) {
      await expect(
        w.issue.execute(actor, { name: 'a', expiresInDays: bad }),
      ).rejects.toBeInstanceOf(ValidationFailedError);
    }
    await expect(w.issue.execute(actor, { name: '   ' })).rejects.toBeInstanceOf(
      ValidationFailedError,
    );
    await expect(w.issue.execute(actor, { name: 'x'.repeat(81) })).rejects.toBeInstanceOf(
      ValidationFailedError,
    );
    expect(w.tokens.all()).toHaveLength(1);
  });

  it('allows at most 10 active tokens per user; revoked and expired ones do not count', async () => {
    const w = createTokenWorld();
    const { actor } = seedOwner(w);
    seedOwner(w, { id: 'usr_2', clerkId: 'clerk_2' });
    const issued = [];
    for (let i = 0; i < 10; i += 1) issued.push(await w.issue.execute(actor, { name: `t${i}` }));
    await expect(w.issue.execute(actor, { name: 'eleventh' })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await w.revoke.execute(actor, { id: issued[0]?.id ?? '' });
    await expect(w.issue.execute(actor, { name: 'again' })).resolves.toBeDefined();
    // another user is not limited by this one
    await expect(
      w.issue.execute({ ...actor, userId: 'usr_2', clerkId: 'clerk_2' }, { name: 'other' }),
    ).resolves.toBeDefined();
    // expired tokens free the slot
    w.clock.advance(91 * DAY);
    await expect(w.issue.execute(actor, { name: 'late' })).resolves.toBeDefined();
  });

  it('records CREATE on API_TOKEN with the prefix and never the secret', async () => {
    const w = createTokenWorld();
    const { actor } = seedOwner(w);
    const out = await w.issue.execute(actor, { name: 'ci' });
    expect(w.activity.entries).toHaveLength(1);
    const entry = w.activity.entries[0];
    expect(entry).toMatchObject({
      action: 'CREATE',
      entityType: 'API_TOKEN',
      entityId: out.id,
      entityLabel: 'ci',
      actor: { actorType: 'USER', userId: actor.userId },
      metadata: { prefix: out.prefix },
    });
    expect(JSON.stringify(entry)).not.toContain(out.secret);
    expect(JSON.stringify(entry)).not.toContain(w.secrets.hash(out.secret));
    expect(w.uow.lastOptions?.isolation).toBe('Serializable');
  });
});

describe('ListApiTokens', () => {
  it('lists only the caller tokens, newest first, without secret or hash', async () => {
    const w = createTokenWorld();
    const { actor } = seedOwner(w);
    const other = seedOwner(w, { id: 'usr_2', clerkId: 'clerk_2' });
    await w.issue.execute(actor, { name: 'first' });
    w.clock.advance(1000);
    await w.issue.execute(actor, { name: 'second' });
    await w.issue.execute(other.actor, { name: 'foreign' });
    const out = await w.list.execute(actor);
    expect(out.map((t) => t.name)).toEqual(['second', 'first']);
    for (const t of out) {
      expect(Object.keys(t).sort()).toEqual(
        ['createdAt', 'expiresAt', 'id', 'lastUsedAt', 'name', 'prefix', 'revokedAt'].sort(),
      );
    }
  });
});

describe('RevokeApiToken', () => {
  it('revokes an own token, is idempotent and audits only the first revocation', async () => {
    const w = createTokenWorld();
    const { actor } = seedOwner(w);
    const t = await w.issue.execute(actor, { name: 'ci' });
    const first = await w.revoke.execute(actor, { id: t.id });
    expect(first.revokedAt).toEqual(w.clock.now());
    w.clock.advance(5000);
    const second = await w.revoke.execute(actor, { id: t.id });
    expect(second.revokedAt).toEqual(first.revokedAt);
    const updates = w.activity.entries.filter((e) => e.action === 'UPDATE');
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ entityType: 'API_TOKEN', entityId: t.id });
    expect(JSON.stringify(updates[0])).not.toContain(t.secret);
  });

  it("answers not found for another user's or an unknown token", async () => {
    const w = createTokenWorld();
    const { actor } = seedOwner(w);
    const other = seedOwner(w, { id: 'usr_2', clerkId: 'clerk_2' });
    const t = await w.issue.execute(other.actor, { name: 'theirs' });
    await expect(w.revoke.execute(actor, { id: t.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(w.revoke.execute(actor, { id: 'nope' })).rejects.toBeInstanceOf(NotFoundError);
    expect(w.tokens.all()[0]?.revokedAt).toBeNull();
  });
});
