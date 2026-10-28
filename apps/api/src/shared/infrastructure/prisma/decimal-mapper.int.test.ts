import { afterAll, beforeEach, expect, it } from 'vitest';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import {
  dateOnlyToDbDate,
  dbDateToDateOnly,
  decimalToString,
  stringToDecimal,
} from './decimal-mapper';

const admin = createTestPrisma();
beforeEach(async () => {
  await truncateBusinessTables(admin);
});
afterAll(async () => {
  await admin.$disconnect();
});

it('round-trips "1234.50" and a @db.Date through Postgres exactly', async () => {
  const currency = await admin.currency.findFirstOrThrow();
  const client = await admin.client.create({
    data: {
      code: 'CLI-0001',
      kind: 'PERSONA',
      tradeName: 'T',
      legalName: 'L',
      taxId: 'V-1',
      country: 'VE',
      address: 'a',
      phone: '1',
    },
  });
  void currency;
  const rows = await admin.$queryRaw<{ amount: unknown; day: Date }[]>`
    SELECT ${stringToDecimal('1234.50')}::numeric(18,2) AS amount, ${dateOnlyToDbDate('2026-10-24')}::date AS day`;
  expect(client.id).toBeTruthy();
  const amount = stringToDecimal(String(rows[0]?.amount));
  expect(decimalToString(amount)).toBe('1234.5');
  expect(amount.toFixed(2)).toBe('1234.50');
  expect(dbDateToDateOnly(rows[0]?.day as Date)).toBe('2026-10-24');
});
