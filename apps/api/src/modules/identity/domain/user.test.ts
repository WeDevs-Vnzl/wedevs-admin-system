import { describe, expect, it } from 'vitest';
import { normalizeEmail, parseUserRole, resolveInitialRole, wouldRemoveLastOwner } from './user';

describe('resolveInitialRole (Q-BE1-2)', () => {
  it('reads a valid role from the Clerk public metadata', () => {
    expect(resolveInitialRole({ role: 'OWNER' })).toBe('OWNER');
    expect(resolveInitialRole({ role: 'MEMBER' })).toBe('MEMBER');
  });

  it('falls back to VIEWER (least privilege) when missing or invalid', () => {
    for (const metadata of [
      undefined,
      null,
      {},
      { role: 'ROOT' },
      { role: 'owner' },
      { role: 3 },
      'OWNER',
      [],
    ]) {
      expect(resolveInitialRole(metadata)).toBe('VIEWER');
    }
  });
});

describe('parseUserRole', () => {
  it('accepts the four roles only', () => {
    expect(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'].map(parseUserRole)).toEqual([
      'OWNER',
      'ADMIN',
      'MEMBER',
      'VIEWER',
    ]);
    expect(parseUserRole('GOD')).toBeNull();
    expect(parseUserRole(undefined)).toBeNull();
  });
});

describe('wouldRemoveLastOwner', () => {
  it('is true only when demoting the single remaining Owner', () => {
    expect(wouldRemoveLastOwner({ role: 'OWNER' }, 'ADMIN', 1)).toBe(true);
    expect(wouldRemoveLastOwner({ role: 'OWNER' }, 'ADMIN', 2)).toBe(false);
    expect(wouldRemoveLastOwner({ role: 'OWNER' }, 'OWNER', 1)).toBe(false);
    expect(wouldRemoveLastOwner({ role: 'ADMIN' }, 'VIEWER', 1)).toBe(false);
  });
});

describe('normalizeEmail', () => {
  it('trims and lower-cases', () => {
    expect(normalizeEmail('  Nueva@Example.COM ')).toBe('nueva@example.com');
  });
});
