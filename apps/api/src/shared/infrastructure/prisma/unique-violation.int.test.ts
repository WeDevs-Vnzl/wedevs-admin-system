import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import { isUniqueViolation } from './unique-violation';

const prisma = createTestPrisma();

beforeAll(() => truncateBusinessTables(prisma));
afterAll(() => prisma.$disconnect());

async function capture(work: () => Promise<unknown>): Promise<unknown> {
  try {
    await work();
  } catch (error) {
    return error;
  }
  throw new Error('expected a failure');
}

describe('isUniqueViolation against Postgres', () => {
  it('recognizes the partial unique contact_one_primary and the Client.code unique', async () => {
    const client = (code: string) => ({
      code,
      kind: 'EMPRESA' as const,
      tradeName: 'a',
      legalName: 'a',
      taxId: code,
      country: 'US',
      address: 'x',
      phone: '1',
    });
    const a = await prisma.client.create({ data: client('CLI-A') });
    const contact = { clientId: a.id, fullName: 'Ana', isPrimary: true };
    await prisma.contact.create({ data: contact });

    const partial = await capture(() => prisma.contact.create({ data: contact }));
    expect(isUniqueViolation(partial)).toBe(true);
    expect(isUniqueViolation(partial, 'contact_one_primary')).toBe(true);
    expect(isUniqueViolation(partial, 'some_other_index')).toBe(false);

    const dup = await capture(() => prisma.client.create({ data: client('CLI-A') }));
    expect(isUniqueViolation(dup)).toBe(true);
    expect(isUniqueViolation(dup, 'contact_one_primary')).toBe(false);
  });

  it('does not match a foreign-key violation', async () => {
    const fk = await capture(() =>
      prisma.contact.create({ data: { clientId: 'missing', fullName: 'x' } }),
    );
    expect(isUniqueViolation(fk)).toBe(false);
  });
});
