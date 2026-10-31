import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CreateMovement } from '../../../src/modules/finance/application/use-cases/accounts/create-movement.use-case';
import { CreateTransfer } from '../../../src/modules/finance/application/use-cases/accounts/create-transfer.use-case';
import { PrismaAccountRepository } from '../../../src/modules/finance/infrastructure/prisma-account.repository';
import { MatrixAuthorization } from '../../../src/modules/identity/infrastructure/matrix-authorization';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import type {
  IsolationLevel,
  UnitOfWorkOptions,
  UnitOfWorkPort,
} from '../../../src/shared/application/ports/unit-of-work.port';
import { CuidGenerator } from '../../../src/shared/infrastructure/id-generator.adapter';
import { PrismaActivityLog } from '../../../src/shared/infrastructure/prisma/prisma-activity-log';
import { PrismaRowLocks } from '../../../src/shared/infrastructure/prisma/prisma-row-locks';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { SystemClock } from '../../../src/shared/infrastructure/system-clock.adapter';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { buildWorld as buildFinanceWorld, type WorldHooks } from '../read-models/world';
import { Gate, gated, interleave } from '../concurrency/world';
import { assertLocalDatabaseUrl } from '../../support/local-db-guard';

/**
 * Two truly concurrent transactions over real PostgreSQL (lessons B3, M1, M2; Q-BE3-1). The first one is paused
 * (`Gate`) inside the projector; the second one then runs and, with the ordered `Account` locks, waits for the
 * first. The scenarios run under the production `Serializable` isolation and again with the isolation forced to
 * `ReadCommitted`, where only the row locks stand between the two writers: a lock that works does not depend on
 * the isolation level. Without the locks the same scenarios lose a balance or deadlock.
 */
const ROUNDS = 2;
const admin = createTestPrisma();
const service = new PrismaService({
  DATABASE_URL: assertLocalDatabaseUrl(process.env.DATABASE_URL),
});

/** Records the deadlocks that surface from `work` before the unit of work retries them, and can force isolation. */
class ProbeUnitOfWork implements UnitOfWorkPort {
  deadlocks = 0;

  constructor(
    private readonly inner: UnitOfWorkPort,
    private readonly forced: IsolationLevel | undefined,
  ) {}

  run<T>(work: () => Promise<T>, options?: UnitOfWorkOptions): Promise<T> {
    return this.inner.run(
      async () => {
        try {
          return await work();
        } catch (error) {
          if (isDeadlock(error)) this.deadlocks += 1;
          throw error;
        }
      },
      this.forced ? { isolation: this.forced } : options,
    );
  }
}

function isDeadlock(error: unknown, depth = 0): boolean {
  if (typeof error !== 'object' || error === null || depth > 4) return false;
  const e = error as { message?: unknown; originalCode?: unknown; code?: unknown; cause?: unknown };
  return (
    e.originalCode === '40P01' ||
    e.code === '40P01' ||
    (typeof e.message === 'string' && /deadlock detected/i.test(e.message)) ||
    isDeadlock(e.cause, depth + 1)
  );
}

function build(hooks: WorldHooks & { isolation?: IsolationLevel } = {}) {
  const world = buildFinanceWorld(service, hooks);
  const uow = new ProbeUnitOfWork(world.uow, hooks.isolation);
  const accounts = new PrismaAccountRepository(world.host);
  const locks = new PrismaRowLocks(world.host);
  const authorization = new MatrixAuthorization();
  const activity = new PrismaActivityLog(world.host, world.metrics);
  const clock = new SystemClock();
  const ids = new CuidGenerator();
  const partners = {
    find: async (id: string) => ({ id, name: id }),
    list: async () => [],
  };
  return {
    world,
    uow,
    transfer: new CreateTransfer(
      authorization,
      uow,
      locks,
      accounts,
      world.projector,
      activity,
      clock,
      ids,
    ),
    movement: new CreateMovement(
      authorization,
      uow,
      locks,
      accounts,
      partners,
      world.projector,
      activity,
      clock,
      ids,
    ),
  };
}

let actor: CurrentUser;

beforeAll(() => truncateBusinessTables(admin), 60_000);
beforeEach(async () => {
  await truncateBusinessTables(admin);
  const row = await admin.user.create({
    data: {
      clerkId: 'user_accounts_conc',
      email: 'accounts-conc@example.test',
      name: 'Owner',
      role: 'OWNER',
    },
  });
  actor = {
    userId: row.id,
    clerkId: row.clerkId,
    role: 'OWNER',
    email: row.email,
    name: row.name,
  };
}, 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});

async function seedAccounts(...ids: string[]) {
  for (const id of ids) {
    await admin.account.create({
      data: {
        id,
        name: id,
        type: 'BANCO_INTERNACIONAL',
        currency: 'USD',
        openingBalance: '1000.00',
        balance: '1000.00',
        openingDate: new Date('2026-01-01'),
      },
    });
  }
}

const balanceOf = async (id: string) =>
  (await admin.account.findUniqueOrThrow({ where: { id } })).balance.toFixed(2);

/** The view's last running balance of the account: it must equal `Account.balance` (§9.7). */
async function ledgerBalanceOf(id: string) {
  const rows = await admin.$queryRaw<{ balance: { toFixed(n: number): string } }[]>`
    SELECT balance FROM account_ledger_v WHERE "accountId" = ${id}
    ORDER BY "date" DESC, seq DESC, "createdAt" DESC, "sourceId" DESC LIMIT 1`;
  return rows[0]?.balance.toFixed(2);
}

const transferInput = (from: string, to: string, amount: string) => ({
  date: '2026-04-01',
  fromAccountId: from,
  toAccountId: to,
  amountFrom: amount,
  amountTo: amount,
  usdRate: '1',
});

const isolations: (IsolationLevel | undefined)[] = [undefined, 'ReadCommitted'];

describe.each(isolations)('account writes under concurrency (isolation: %s)', (isolation) => {
  it('transfers A→B and B→A run together without a deadlock and leave both balances exact', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await truncateBusinessTables(admin);
      await admin.user.create({
        data: {
          id: actor.userId,
          clerkId: actor.clerkId,
          email: actor.email,
          name: 'Owner',
          role: 'OWNER',
        },
      });
      await seedAccounts('acc_a', 'acc_b');
      const gate = new Gate();
      // The first writer stops right after its first balance write, holding that row.
      const slow = build({
        isolation,
        writer: (w) => gated(w, gate, ['writeAccountBalance'], 'after'),
      });
      const fast = build({ isolation });

      const results = await interleave(
        admin,
        gate,
        () => slow.transfer.execute(actor, transferInput('acc_a', 'acc_b', '100.00')),
        () => fast.transfer.execute(actor, transferInput('acc_b', 'acc_a', '30.00')),
      );

      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
      expect(slow.uow.deadlocks + fast.uow.deadlocks).toBe(0);
      expect(await balanceOf('acc_a')).toBe('930.00');
      expect(await balanceOf('acc_b')).toBe('1070.00');
      expect(await ledgerBalanceOf('acc_a')).toBe('930.00');
      expect(await ledgerBalanceOf('acc_b')).toBe('1070.00');
      expect(await admin.accountTransfer.count()).toBe(2);
      expect(await admin.financeFact.count({ where: { kind: 'TRANSFER_OUT' } })).toBe(2);
      expect(await admin.financeFact.count({ where: { kind: 'TRANSFER_IN' } })).toBe(2);
    }
  });

  it('movements on one account lose nothing', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await truncateBusinessTables(admin);
      await admin.user.create({
        data: {
          id: actor.userId,
          clerkId: actor.clerkId,
          email: actor.email,
          name: 'Owner',
          role: 'OWNER',
        },
      });
      await seedAccounts('acc_a');
      const gate = new Gate();
      // The first writer stops after reading the account's entries, before writing its balance.
      const slow = build({ isolation, sources: (s) => gated(s, gate, ['accountSource'], 'after') });
      const fast = build({ isolation });
      const movement = (type: 'APORTE_CAPITAL' | 'RETIRO_SOCIO', amount: string) => ({
        accountId: 'acc_a',
        type,
        date: '2026-05-01',
        amount,
        usdRate: '1',
        partnerId: actor.userId,
        description: type,
      });

      const results = await interleave(
        admin,
        gate,
        () => slow.movement.execute(actor, movement('APORTE_CAPITAL', '40.00')),
        () => fast.movement.execute(actor, movement('RETIRO_SOCIO', '10.00')),
      );

      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
      expect(await admin.accountMovement.count()).toBe(2);
      expect(await balanceOf('acc_a')).toBe('1030.00');
      expect(await ledgerBalanceOf('acc_a')).toBe('1030.00');
      expect(await admin.financeFact.count({ where: { kind: 'MOVEMENT_IN' } })).toBe(1);
      expect(await admin.financeFact.count({ where: { kind: 'MOVEMENT_OUT' } })).toBe(1);
    }
  });
});
