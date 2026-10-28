import { describe, expect, it } from 'vitest';
import type { CurrentUser } from '../../../shared/application/current-user';
import { USER_ROLE_VALUES, type UserRole } from '../../../shared/domain/enums';
import { MatrixAuthorization } from './matrix-authorization';

const user = (role: UserRole, userId = `usr_${role}`): CurrentUser => ({
  userId,
  clerkId: `clerk_${role}`,
  role,
  email: `${role}@example.com`,
  name: role,
});

describe('MatrixAuthorization', () => {
  const authorization = new MatrixAuthorization();

  it('implements the HU-02 CA1 grant: only the Owner manages users', () => {
    for (const role of USER_ROLE_VALUES) {
      for (const action of ['create', 'read', 'update', 'delete'] as const) {
        expect(authorization.can(user(role), action, 'user')).toBe(role === 'OWNER');
      }
    }
  });

  it('passes the owner id through (Member deletes only their own notes)', () => {
    const member = user('MEMBER', 'usr_m');
    expect(authorization.can(member, 'delete', 'note', { ownerId: 'usr_m' })).toBe(true);
    expect(authorization.can(member, 'delete', 'note', { ownerId: 'other' })).toBe(false);
    expect(authorization.can(member, 'delete', 'note')).toBe(false);
  });

  it('Member is refused on a financial resource (HU-02 CA2)', () => {
    for (const action of ['create', 'read', 'update', 'delete'] as const) {
      expect(authorization.can(user('MEMBER'), action, 'invoice')).toBe(false);
    }
  });

  it('canSeeFinancials follows the invoice read grant', () => {
    expect(USER_ROLE_VALUES.map((role) => authorization.canSeeFinancials(user(role)))).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });
});
