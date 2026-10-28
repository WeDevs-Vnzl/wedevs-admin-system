import { describe, expect, it } from 'vitest';
import { isUniqueViolation } from './unique-violation';

describe('isUniqueViolation', () => {
  it('recognizes Prisma P2002, SQLSTATE 23505 and the driver-adapter shape', () => {
    expect(isUniqueViolation({ code: 'P2002' })).toBe(true);
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ cause: { originalCode: '23505' } })).toBe(true);
    expect(isUniqueViolation({ cause: { kind: 'UniqueConstraintViolation' } })).toBe(true);
    expect(isUniqueViolation({ code: 'P2002', meta: { cause: { originalCode: '23505' } } })).toBe(
      true,
    );
  });

  it('rejects other errors', () => {
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
    expect(isUniqueViolation({ code: 'P2025' })).toBe(false);
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation('23505')).toBe(false);
  });

  it('matches a named constraint in message, constraint, target or nested cause', () => {
    const name = 'contact_one_primary';
    expect(
      isUniqueViolation({ code: 'P2002', meta: { target: ['contact_one_primary'] } }, name),
    ).toBe(true);
    expect(
      isUniqueViolation(
        { kind: 'UniqueConstraintViolation', cause: { constraint: { index: name } } },
        name,
      ),
    ).toBe(true);
    expect(
      isUniqueViolation(
        {
          code: 'P2002',
          message: 'Unique constraint failed on the constraint: `contact_one_primary`',
        },
        name,
      ),
    ).toBe(true);
    expect(isUniqueViolation({ code: 'P2002', meta: { target: ['email'] } }, name)).toBe(false);
  });
});
