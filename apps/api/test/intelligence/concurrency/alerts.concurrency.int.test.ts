import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MatrixAuthorization } from '../../../src/modules/identity/application/matrix-authorization';
import type { AlertStateRepository } from '../../../src/modules/intelligence/application/ports/alert-state.repository.port';
import { DismissAlert } from '../../../src/modules/intelligence/application/use-cases/alerts/dismiss-alert.use-case';
import { MarkAlertsRead } from '../../../src/modules/intelligence/application/use-cases/alerts/mark-alerts-read.use-case';
import { PrismaAlertStateRepository } from '../../../src/modules/intelligence/infrastructure/prisma-alert-state.repository';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import type { AlertHiding } from '../../../src/modules/intelligence/domain/alert-state';
import { PrismaUnitOfWork } from '../../../src/shared/infrastructure/prisma/prisma-unit-of-work';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { TransactionHost } from '../../../src/shared/infrastructure/prisma/transaction-host';
import { CuidGenerator } from '../../../src/shared/infrastructure/id-generator.adapter';
import { SystemClock } from '../../../src/shared/infrastructure/system-clock.adapter';
import { makeUser } from '../../db/helpers';
import { Gate, gated, interleave } from '../../finance/concurrency/world';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';

/**
 * Alert state is a single-row upsert on `(userId, alertKey)`. Two truly concurrent writers over real
 * PostgreSQL: the first one is paused (`Gate`) right after its statement, inside an open transaction, so its
 * row is written but not committed; the second one then runs against that row. A naive find-then-create loses
 * (the control below); the single-statement upsert neither duplicates the row nor loses a column.
 */
const ROUNDS = 3;
const KEY = 'INVOICE_OVERDUE:inv_1';
const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });
let user: CurrentUser;

beforeAll(() => truncateBusinessTables(admin), 60_000);
beforeEach(async () => {
  await truncateBusinessTables(admin);
  const row = await makeUser(admin);
  user = { userId: row.id, clerkId: row.clerkId, role: 'OWNER', email: row.email, name: row.name };
}, 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});

/** One application world: own `TransactionHost`, so a transaction opened here is invisible to the other. */
function world(wrap: (repo: AlertStateRepository) => AlertStateRepository = (repo) => repo) {
  const host = new TransactionHost(service);
  const states = wrap(new PrismaAlertStateRepository(host, new CuidGenerator()));
  const authorization = new MatrixAuthorization();
  const clock = new SystemClock();
  const uow = new PrismaUnitOfWork(host);
  return {
    uow,
    dismiss: new DismissAlert(authorization, uow, states, clock),
    markRead: new MarkAlertsRead(authorization, uow, states, clock),
  };
}

const fulfilled = (result: PromiseSettledResult<unknown>) => result.status === 'fulfilled';
const rows = () => admin.alertState.findMany();

describe('two dismissals of one key', () => {
  it('leave one row and no 500, the later committer wins', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await admin.alertState.deleteMany();
      const gate = new Gate();
      const slow = world((repo) => gated(repo, gate, ['hide'], 'after'));
      const fast = world();

      const results = await interleave(
        admin,
        gate,
        () => slow.uow.run(() => slow.dismiss.execute(user, { alertKey: KEY })),
        () => fast.dismiss.execute(user, { alertKey: KEY, days: 2 }),
      );

      expect(results.every(fulfilled)).toBe(true);
      const stored = await rows();
      expect(stored).toHaveLength(1);
      // The snooze committed after the permanent dismissal and replaced it.
      expect(stored[0]).toMatchObject({ dismissedAt: null });
      expect(stored[0]?.dismissedUntil).not.toBeNull();
    }
  });

  it('many at once without any pause still leave one row', async () => {
    const callers = Array.from({ length: 12 }, () => world());
    const results = await Promise.allSettled(
      callers.map((w, i) =>
        w.dismiss.execute(user, i % 2 === 0 ? { alertKey: KEY } : { alertKey: KEY, days: i }),
      ),
    );
    expect(results.every(fulfilled)).toBe(true);
    expect(await rows()).toHaveLength(1);
  });
});

describe('read against dismiss', () => {
  it('a read that waits behind an uncommitted dismissal keeps both columns', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await admin.alertState.deleteMany();
      const gate = new Gate();
      const slow = world((repo) => gated(repo, gate, ['hide'], 'after'));
      const fast = world();

      const results = await interleave(
        admin,
        gate,
        () => slow.uow.run(() => slow.dismiss.execute(user, { alertKey: KEY })),
        () => fast.markRead.execute(user, { alertKeys: [KEY] }),
      );

      expect(results.every(fulfilled)).toBe(true);
      const stored = await rows();
      expect(stored).toHaveLength(1);
      expect(stored[0]?.dismissedAt).not.toBeNull();
      expect(stored[0]?.readAt).not.toBeNull();
    }
  });

  it('a dismissal that waits behind an uncommitted read keeps both columns', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await admin.alertState.deleteMany();
      const gate = new Gate();
      const slow = world((repo) => gated(repo, gate, ['markRead'], 'after'));
      const fast = world();

      const results = await interleave(
        admin,
        gate,
        () => slow.uow.run(() => slow.markRead.execute(user, { alertKeys: [KEY] })),
        () => fast.dismiss.execute(user, { alertKey: KEY, days: 5 }),
      );

      expect(results.every(fulfilled)).toBe(true);
      const stored = await rows();
      expect(stored).toHaveLength(1);
      expect(stored[0]?.dismissedUntil).not.toBeNull();
      expect(stored[0]?.readAt).not.toBeNull();
    }
  });

  it('overlapping read batches in opposite order finish without deadlock', async () => {
    const keysA = Array.from({ length: 40 }, (_, i) => `INVOICE_OVERDUE:k${i}`);
    const keysB = [...keysA].reverse();
    const callers = Array.from({ length: 6 }, () => world());
    const results = await Promise.allSettled(
      callers.map((w, i) => w.markRead.execute(user, { alertKeys: i % 2 === 0 ? keysA : keysB })),
    );
    expect(results.every(fulfilled)).toBe(true);
    expect(await rows()).toHaveLength(40);
  });
});

describe('control: why the single statement matters', () => {
  /** The unguarded variant a first draft would write: look the row up, then create or update it. */
  class FindThenCreate {
    constructor(
      private readonly host: TransactionHost,
      private readonly afterFind: () => Promise<void>,
    ) {}

    async hide(userId: string, alertKey: string, hiding: AlertHiding): Promise<void> {
      const existing = await this.host.db.alertState.findUnique({
        where: { userId_alertKey: { userId, alertKey } },
      });
      await this.afterFind();
      if (existing) {
        await this.host.db.alertState.update({ where: { id: existing.id }, data: hiding });
      } else {
        await this.host.db.alertState.create({ data: { userId, alertKey, ...hiding } });
      }
    }
  }

  it('lets the second creator fail with a unique violation', async () => {
    const gate = new Gate();
    const slowHost = new TransactionHost(service);
    const fastHost = new TransactionHost(service);
    const slow = new FindThenCreate(slowHost, () => gate.pause());
    const fast = new FindThenCreate(fastHost, () => Promise.resolve());
    const hiding = { dismissedAt: new Date(), dismissedUntil: null };

    const results = await interleave(
      admin,
      gate,
      () => slow.hide(user.userId, KEY, hiding),
      () => fast.hide(user.userId, KEY, hiding),
    );

    expect(results.filter(fulfilled)).toHaveLength(1);
    expect(await rows()).toHaveLength(1);
  });
});
