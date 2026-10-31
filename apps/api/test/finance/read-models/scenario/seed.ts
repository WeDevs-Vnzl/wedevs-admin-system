import type { PrismaClient } from '../../../../src/generated/prisma/client';
import type { Ctx } from './ops-base';
import type { World } from './world';

/** Clients, multi-client projects, rates and accounts every run starts from. Money data is generated. */
export const CLIENT_IDS = ['cli_a', 'cli_b', 'cli_c'] as const;
export const PROJECTS: readonly { id: string; clients: readonly string[] }[] = [
  { id: 'pry_1', clients: ['cli_a'] },
  { id: 'pry_2', clients: ['cli_a', 'cli_b'] },
  { id: 'pry_3', clients: ['cli_b', 'cli_c'] },
  { id: 'pry_4', clients: ['cli_c'] },
  { id: 'pry_5', clients: ['cli_a', 'cli_b', 'cli_c'] },
];

async function seedCommercial(db: PrismaClient): Promise<void> {
  for (const [index, id] of CLIENT_IDS.entries()) {
    await db.client.create({
      data: {
        id,
        code: `CLI-000${index + 1}`,
        kind: 'EMPRESA',
        tradeName: id,
        legalName: `${id} C.A.`,
        taxId: `J-00000${index + 1}`,
        country: 'VE',
        address: 'Av. Principal',
        phone: '+584121234567',
      },
    });
    // `projectCount` belongs to `commercial`: the rebuild must leave it exactly as the use cases did.
    await db.clientMetrics.create({
      data: {
        clientId: id,
        projectCount: PROJECTS.filter((project) => project.clients.includes(id)).length,
      },
    });
  }
  for (const [index, project] of PROJECTS.entries()) {
    await db.project.create({
      data: {
        id: project.id,
        code: `PRY-000${index + 1}`,
        name: project.id,
        summary: 'Resumen',
        clients: { create: project.clients.map((clientId) => ({ clientId })) },
      },
    });
  }
}

export async function seedBase(world: World): Promise<Pick<Ctx, 'refs'>> {
  const { db, uc, owner } = world;
  await seedCommercial(db);
  for (const date of ['2026-01-01', '2026-03-01']) {
    await uc.upsertRate.execute(owner, {
      date,
      currency: 'VES',
      usdRate: '38.5',
      source: 'MANUAL',
    });
    await uc.upsertRate.execute(owner, {
      date,
      currency: 'EUR',
      usdRate: '0.92',
      source: 'MANUAL',
    });
  }
  for (const [name, currency, opening] of [
    ['Zelle', 'USD', '1500.00'],
    ['Caja USD', 'USD', '300.00'],
    ['Banco VES', 'VES', '25000.00'],
    ['Banco EUR', 'EUR', '800.00'],
  ] as const) {
    await uc.createAccount.execute(owner, {
      name,
      type: 'BANCO_INTERNACIONAL',
      currency,
      openingBalance: opening,
      openingDate: '2026-01-01',
    });
  }
  const methods = await db.paymentMethod.findMany();
  const category = await db.expenseCategory.findFirstOrThrow({ orderBy: { id: 'asc' } });
  return {
    refs: {
      methods: Object.fromEntries(methods.map((method) => [method.code, method.id])),
      categoryId: category.id,
    },
  };
}
