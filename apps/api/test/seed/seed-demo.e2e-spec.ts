import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedCatalogs } from '../../prisma/seed';
import {
  assertDemoSeedTarget,
  NoOwnerError,
  seedDemo,
  wipeBusinessData,
} from '../../prisma/seed-demo';
import { CreateClient } from '../../src/modules/commercial/application/use-cases/create-client.use-case';
import { MatrixAuthorization } from '../../src/modules/identity/application/matrix-authorization';
import type { CurrentUser } from '../../src/shared/application/current-user';
import { AUTHORIZATION } from '../../src/shared/application/ports/tokens';
import type { UserRole } from '../../src/shared/domain/enums';
import { createTestPrisma, truncateBusinessTables } from '../support/db';
import { createTestApp } from '../support/test-app';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const ROLES: readonly UserRole[] = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'];

/** The pilot demo seed over the full app: it wipes business data, keeps the users and rebuilds the data set. */
describe('pilot demo seed', () => {
  const prisma = createTestPrisma();
  let app: NestExpressApplication;
  let owner: CurrentUser;
  let userIds: Record<string, string>;

  beforeAll(async () => {
    app = await createTestApp({
      probes: false,
      overrides: [{ token: AUTHORIZATION, useValue: new MatrixAuthorization() }],
    });
  });

  beforeEach(async () => {
    await truncateBusinessTables(prisma);
    await prisma.user.deleteMany();
    userIds = {};
    for (const role of ROLES) {
      const row = await prisma.user.create({
        data: {
          clerkId: `user_seed_${role.toLowerCase()}`,
          email: `seed-${role.toLowerCase()}@example.test`,
          name: role,
          role,
        },
      });
      userIds[role] = row.id;
      if (role === 'OWNER') {
        owner = { userId: row.id, clerkId: row.clerkId, role, email: row.email, name: row.name };
      }
    }
  });

  afterAll(async () => {
    await truncateBusinessTables(prisma);
    await prisma.user.deleteMany();
    await prisma.$disconnect();
    await app.close();
  });

  const junkClient = () =>
    app.get(CreateClient).execute(owner, {
      kind: 'PERSONA',
      tradeName: 'Junk Client',
      taxId: 'J-99999999-9',
      country: 'VE',
      address: 'Nowhere',
      phone: '+584120000000',
    });

  async function run(): Promise<void> {
    await wipeBusinessData(prisma);
    await seedCatalogs(prisma);
    await seedDemo(app);
  }

  async function counts() {
    return {
      clients: await prisma.client.count(),
      contacts: await prisma.contact.count(),
      tags: await prisma.tag.count(),
      projects: await prisma.project.count(),
      plans: await prisma.billingPlan.count(),
      installments: await prisma.billingInstallment.count(),
      recurringCharges: await prisma.recurringCharge.count(),
      rates: await prisma.exchangeRate.count(),
      accounts: await prisma.account.count(),
      movements: await prisma.accountMovement.count(),
      invoices: await prisma.invoice.count(),
      payments: await prisma.payment.count(),
      allocations: await prisma.paymentAllocation.count(),
      expenses: await prisma.expense.count(),
      recurringExpenses: await prisma.recurringExpense.count(),
      notes: await prisma.note.count(),
      documents: await prisma.document.count(),
      shareLinks: await prisma.shareLink.count(),
    };
  }

  it('keeps the users, drops the junk and builds the data set through the use cases', async () => {
    await junkClient();
    await run();

    const users = await prisma.user.findMany({ orderBy: { role: 'asc' } });
    expect(users.map((u) => u.id).sort()).toEqual(Object.values(userIds).sort());
    expect(await prisma.client.findFirst({ where: { tradeName: 'Junk Client' } })).toBeNull();

    expect(await counts()).toEqual({
      clients: 4,
      contacts: 6,
      tags: 4,
      projects: 3,
      plans: 2,
      installments: 2,
      recurringCharges: 1,
      rates: 5,
      accounts: 3,
      movements: 1,
      invoices: 4,
      payments: 3,
      allocations: 2,
      expenses: 4,
      recurringExpenses: 1,
      notes: 2,
      documents: 2,
      shareLinks: 1,
    });

    const sequences = Object.fromEntries(
      (await prisma.sequence.findMany()).map((s) => [s.name, s.value]),
    );
    expect(sequences.CLI).toBe(4);
    expect(sequences.PRY).toBe(3);
    expect(sequences.DOC).toBe(2);

    expect(await prisma.clientMetrics.count()).toBe(4);
    expect(await prisma.searchEntry.count()).toBeGreaterThan(0);
    expect(await prisma.activityLog.count()).toBeGreaterThan(0);

    const statuses = (await prisma.invoice.findMany()).map((i) => i.status).sort();
    expect(statuses).toEqual(['BORRADOR', 'PAGADA', 'PARCIAL', 'VENCIDA']);
    //DUMP
    expect(await prisma.payment.count({ where: { status: 'CONFIRMADO' } })).toBe(2);
    expect(await prisma.payment.count({ where: { status: 'PENDIENTE_VERIFICACION' } })).toBe(1);
    expect(await prisma.expense.count({ where: { status: 'PAGADO' } })).toBe(3);
    expect(await prisma.expense.count({ where: { status: 'PENDIENTE' } })).toBe(1);
  });

  it('yields the same counts when it runs twice', async () => {
    await run();
    const first = await counts();
    await run();
    expect(await counts()).toEqual(first);
    expect((await prisma.sequence.findFirstOrThrow({ where: { name: 'CLI' } })).value).toBe(4);
    expect(await prisma.user.count()).toBe(4);
  });

  it('refuses to wipe without an active OWNER and leaves the data untouched', async () => {
    await junkClient();
    await prisma.user.updateMany({ where: { role: 'OWNER' }, data: { deletedAt: new Date() } });
    await expect(wipeBusinessData(prisma)).rejects.toBeInstanceOf(NoOwnerError);
    expect(await prisma.client.count()).toBe(1);
  });

  it('refuses a non-local database, even with --allow-remote', () => {
    const remote = 'postgresql://u:p@db.example.com:5432/core';
    expect(() => assertDemoSeedTarget(remote, [])).toThrow();
    expect(() => assertDemoSeedTarget(remote, ['--allow-remote'])).toThrow();
    expect(() => assertDemoSeedTarget('postgresql://u:p@localhost:5434/core', [])).not.toThrow();
    expect(() => assertDemoSeedTarget(undefined, [])).toThrow();
  });
});
