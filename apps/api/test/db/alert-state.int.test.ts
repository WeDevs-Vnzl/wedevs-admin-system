import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { createTestPrisma, truncateBusinessTables } from '../support/db';
import { expectViolation, makeUser, uid } from './helpers';

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createTestPrisma();
  await truncateBusinessTables(prisma);
});

beforeEach(async () => {
  await truncateBusinessTables(prisma);
});

afterAll(async () => {
  await truncateBusinessTables(prisma);
  await prisma.$disconnect();
});

describe('AlertState dismissedAt (Δ16, DT-163)', () => {
  it('stores read-only, snoozed and permanent rows side by side for one user', async () => {
    const user = await makeUser(prisma);
    const snoozeEnd = new Date('2026-12-01T10:00:00.000Z');
    const dismissedAt = new Date('2026-11-01T15:30:00.000Z');
    const readAt = new Date('2026-11-01T09:00:00.000Z');

    const readOnly = await prisma.alertState.create({
      data: { userId: user.id, alertKey: `INVOICE_OVERDUE:${uid('i')}`, readAt },
    });
    const snoozed = await prisma.alertState.create({
      data: { userId: user.id, alertKey: `INVOICE_OVERDUE:${uid('i')}`, dismissedUntil: snoozeEnd },
    });
    const permanent = await prisma.alertState.create({
      data: { userId: user.id, alertKey: `INVOICE_OVERDUE:${uid('i')}`, dismissedAt },
    });

    const rows = await prisma.alertState.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(3);
    const byId = new Map(rows.map((r) => [r.id, r]));

    expect(byId.get(readOnly.id)).toMatchObject({
      readAt,
      dismissedAt: null,
      dismissedUntil: null,
    });
    expect(byId.get(snoozed.id)).toMatchObject({
      dismissedUntil: snoozeEnd,
      dismissedAt: null,
      readAt: null,
    });
    expect(byId.get(permanent.id)).toMatchObject({
      dismissedAt,
      dismissedUntil: null,
      readAt: null,
    });
  });

  it('keeps the (userId, alertKey) unique and allows the same key for another user', async () => {
    const user = await makeUser(prisma);
    const other = await makeUser(prisma);
    const alertKey = `INVOICE_OVERDUE:${uid('i')}`;

    await prisma.alertState.create({
      data: { userId: user.id, alertKey, dismissedAt: new Date() },
    });
    await expectViolation(
      prisma.alertState.create({ data: { userId: user.id, alertKey, readAt: new Date() } }),
      'AlertState_userId_alertKey_key',
    );
    await expect(
      prisma.alertState.create({ data: { userId: other.id, alertKey } }),
    ).resolves.toBeTruthy();

    expect(await prisma.alertState.count({ where: { alertKey } })).toBe(2);
  });

  it('upserts on the unique: dismissing clears the snooze, restore clears both and keeps readAt', async () => {
    const user = await makeUser(prisma);
    const alertKey = `INVOICE_OVERDUE:${uid('i')}`;
    const readAt = new Date('2026-11-01T09:00:00.000Z');
    const key = { userId_alertKey: { userId: user.id, alertKey } };

    await prisma.alertState.upsert({
      where: key,
      create: {
        userId: user.id,
        alertKey,
        readAt,
        dismissedUntil: new Date('2026-12-01T00:00:00Z'),
      },
      update: {},
    });
    await prisma.alertState.upsert({
      where: key,
      create: { userId: user.id, alertKey },
      update: { dismissedAt: new Date('2026-11-02T00:00:00Z'), dismissedUntil: null },
    });
    expect(await prisma.alertState.findUniqueOrThrow({ where: key })).toMatchObject({
      readAt,
      dismissedUntil: null,
      dismissedAt: new Date('2026-11-02T00:00:00Z'),
    });

    await prisma.alertState.update({
      where: key,
      data: { dismissedAt: null, dismissedUntil: null },
    });
    expect(await prisma.alertState.findUniqueOrThrow({ where: key })).toMatchObject({
      readAt,
      dismissedAt: null,
      dismissedUntil: null,
    });
    expect(await prisma.alertState.count({ where: { userId: user.id } })).toBe(1);
  });
});
