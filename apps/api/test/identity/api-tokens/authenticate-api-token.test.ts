import { describe, expect, it } from 'vitest';
import { ApiTokenAuthenticator } from '../../../src/modules/identity/infrastructure/api-token-authenticator';
import { createTokenWorld, seedOwner } from './world';

const DAY = 86_400_000;

async function issued() {
  const w = createTokenWorld();
  const { actor, owner } = seedOwner(w, { role: 'OWNER' });
  const token = await w.issue.execute(actor, { name: 'mcp' });
  return { w, actor, owner, token };
}

describe('AuthenticateApiToken', () => {
  it('resolves the token to the local user and its DB role', async () => {
    const { w, actor, token } = await issued();
    await expect(w.authenticate.execute(token.secret)).resolves.toEqual({
      userId: actor.userId,
      clerkId: actor.clerkId,
      role: 'OWNER',
      email: actor.email,
      name: actor.name,
    });
  });

  it('reads the role from the owner row at each call, so a demotion applies at once (C13)', async () => {
    const { w, owner, token } = await issued();
    w.tokens.seedOwner({ ...owner, role: 'VIEWER' });
    expect((await w.authenticate.execute(token.secret))?.role).toBe('VIEWER');
  });

  it('refuses unknown, malformed and foreign-shaped credentials', async () => {
    const { w, token } = await issued();
    const flipped = `${token.secret.slice(0, -1)}${token.secret.endsWith('B') ? 'C' : 'B'}`;
    for (const bad of [
      flipped,
      '',
      'wdc_pat_',
      token.secret.slice(0, 20),
      `${token.secret}x`,
      token.secret.replace('wdc_pat_', 'wdc_xxx_'),
      'eyJhbGciOiJSUzI1NiJ9.e30.sig',
    ]) {
      await expect(w.authenticate.execute(bad)).resolves.toBeNull();
    }
  });

  it('refuses a revoked token', async () => {
    const { w, actor, token } = await issued();
    await w.revoke.execute(actor, { id: token.id });
    await expect(w.authenticate.execute(token.secret)).resolves.toBeNull();
  });

  it('refuses an expired token, exactly at its expiry instant', async () => {
    const { w, token } = await issued();
    w.clock.set(new Date(token.expiresAt.getTime() - 1));
    await expect(w.authenticate.execute(token.secret)).resolves.not.toBeNull();
    w.clock.set(token.expiresAt);
    await expect(w.authenticate.execute(token.secret)).resolves.toBeNull();
  });

  it('refuses the token of an archived user', async () => {
    const { w, owner, token } = await issued();
    w.tokens.seedOwner({ ...owner, deletedAt: new Date('2026-01-10T00:00:00.000Z') });
    await expect(w.authenticate.execute(token.secret)).resolves.toBeNull();
    expect(w.tokens.touchWrites).toBe(0);
  });

  it('compares the stored digest in constant time through the secrets port', async () => {
    const { w, token } = await issued();
    const calls: [string, string][] = [];
    const original = w.secrets.equals.bind(w.secrets);
    w.secrets.equals = (a, b) => {
      calls.push([a, b]);
      return original(a, b);
    };
    await w.authenticate.execute(token.secret);
    expect(calls).toEqual([[w.secrets.hash(token.secret), w.secrets.hash(token.secret)]]);
  });

  it('touches lastUsedAt at most once a minute', async () => {
    const { w, token } = await issued();
    const start = w.clock.now();
    await w.authenticate.execute(token.secret);
    expect(w.tokens.all()[0]?.lastUsedAt).toEqual(start);
    w.clock.advance(59_000);
    await w.authenticate.execute(token.secret);
    expect(w.tokens.touchWrites).toBe(1);
    expect(w.tokens.all()[0]?.lastUsedAt).toEqual(start);
    w.clock.advance(1_000);
    await w.authenticate.execute(token.secret);
    expect(w.tokens.touchWrites).toBe(2);
    expect(w.tokens.all()[0]?.lastUsedAt?.getTime()).toBe(start.getTime() + 60_000);
    w.clock.advance(DAY);
    await w.authenticate.execute(token.secret);
    expect(w.tokens.touchWrites).toBe(3);
  });

  it('does not touch lastUsedAt for a refused token', async () => {
    const { w, actor, token } = await issued();
    await w.revoke.execute(actor, { id: token.id });
    await w.authenticate.execute(token.secret);
    expect(w.tokens.touchWrites).toBe(0);
  });
});

describe('ApiTokenAuthenticator', () => {
  it('is the AuthenticatorPort over the use case', async () => {
    const { w, actor, token } = await issued();
    const authenticator = new ApiTokenAuthenticator(w.authenticate);
    expect((await authenticator.authenticate(token.secret))?.userId).toBe(actor.userId);
    await expect(authenticator.authenticate('nope')).resolves.toBeNull();
  });
});
