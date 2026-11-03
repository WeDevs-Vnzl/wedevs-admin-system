import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CreateClient } from '../../../src/modules/commercial/application/use-cases/create-client.use-case';
import { PrismaClientRepository } from '../../../src/modules/commercial/infrastructure/prisma-client.repository';
import { PrismaContactRepository } from '../../../src/modules/commercial/infrastructure/prisma-contact.repository';
import { MatrixAuthorization } from '../../../src/modules/identity/application/matrix-authorization';
import { TagAssignments } from '../../../src/modules/settings/application/tag-assignments';
import { PrismaTagAssignmentRepository } from '../../../src/modules/settings/infrastructure/prisma-tag-assignment.repository';
import { PrismaTagRepository } from '../../../src/modules/settings/infrastructure/prisma-tag.repository';
import { CuidGenerator } from '../../../src/shared/infrastructure/id-generator.adapter';
import { PrismaActivityLog } from '../../../src/shared/infrastructure/prisma/prisma-activity-log';
import { PrismaClientMetricsWriter } from '../../../src/shared/infrastructure/prisma/prisma-client-metrics-writer';
import { PrismaSearchIndex } from '../../../src/shared/infrastructure/prisma/prisma-search-index';
import { PrismaSequence } from '../../../src/shared/infrastructure/prisma/prisma-sequence';
import { PrismaUnitOfWork } from '../../../src/shared/infrastructure/prisma/prisma-unit-of-work';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { TransactionHost } from '../../../src/shared/infrastructure/prisma/transaction-host';
import { SystemClock } from '../../../src/shared/infrastructure/system-clock.adapter';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { clientInput } from './world';
import { userOf } from './fixtures';

/** The activity entry references the actor, so the caller must exist as a user. */
async function owner() {
  const row = await admin.user.create({
    data: { clerkId: 'user_owner', email: 'owner@example.test', name: 'Owner', role: 'OWNER' },
  });
  return { ...userOf('OWNER'), userId: row.id };
}

const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });
const host = new TransactionHost(service);
const clients = new PrismaClientRepository(host);
const contacts = new PrismaContactRepository(host);
const assignments = new TagAssignments(
  new PrismaTagRepository(host),
  new PrismaTagAssignmentRepository(host),
);
const createClient = new CreateClient(
  new MatrixAuthorization(),
  new PrismaUnitOfWork(host),
  clients,
  contacts,
  assignments,
  new PrismaActivityLog(host, new PrismaClientMetricsWriter(host)),
  new PrismaSearchIndex(host),
  new PrismaClientMetricsWriter(host),
  new PrismaSequence(host),
  new SystemClock(),
  new CuidGenerator(),
);

beforeAll(async () => {
  await truncateBusinessTables(admin);
}, 60_000);
beforeEach(async () => {
  await truncateBusinessTables(admin);
}, 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});

describe('CreateClient against PostgreSQL (int)', () => {
  it('lets exactly one of two concurrent creates of the same VE tax id succeed', async () => {
    for (let round = 0; round < 3; round++) {
      await truncateBusinessTables(admin);
      const caller = await owner();
      const results = await Promise.allSettled([
        createClient.execute(caller, clientInput({ taxId: 'J-30123456-7', tradeName: 'Uno' })),
        createClient.execute(caller, clientInput({ taxId: 'j301234567', tradeName: 'Dos' })),
      ]);
      const ok = results.filter((r) => r.status === 'fulfilled');
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(ok).toHaveLength(1);
      expect(failed).toHaveLength(1);
      expect(failed[0]?.reason).toMatchObject({ code: 'CONFLICT' });

      expect(await admin.client.count()).toBe(1);
      expect(await admin.searchEntry.count({ where: { entityType: 'CLIENT' } })).toBe(1);
      expect(await admin.clientMetrics.count()).toBe(1);
      // The loser rolled back, so it consumed no code.
      const sequence = await admin.sequence.findUniqueOrThrow({ where: { name: 'CLI' } });
      expect(sequence.value).toBe(1);
      expect((await admin.client.findFirstOrThrow()).code).toBe('CLI-0001');
    }
  });

  it('applies the same guard to a non-VE tax id typed with different separators', async () => {
    const caller = await owner();
    const results = await Promise.allSettled([
      createClient.execute(caller, clientInput({ country: 'CO', taxId: '900.123.456-1' })),
      createClient.execute(caller, clientInput({ country: 'CO', taxId: '900 123 456-1' })),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(failed?.reason).toMatchObject({ code: 'CONFLICT' });
    expect(await admin.client.count()).toBe(1);
  });
});
