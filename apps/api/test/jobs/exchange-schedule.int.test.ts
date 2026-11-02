import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MAINTENANCE_QUEUE } from '../../src/modules/jobs/interface/jobs/maintenance.processor';
import {
  EXCHANGE_SYNC_SCHEDULE,
  registerSchedules,
  schedulesFor,
} from '../../src/modules/jobs/interface/jobs/schedules';
import { startRedis, type RedisContainer } from '../support/redis-container';

/** The exchange-sync scheduler against a real Redis (DT-152, DT-184). No test here waits on the clock. */
let redis: RedisContainer;
const opened: IORedis[] = [];
const queues: Queue[] = [];

const newQueue = () => {
  const connection = new IORedis(redis.url, { maxRetriesPerRequest: null });
  opened.push(connection);
  const queue = new Queue(MAINTENANCE_QUEUE, { connection });
  queues.push(queue);
  return queue;
};

beforeAll(async () => {
  redis = await startRedis();
}, 120_000);
afterEach(async () => {
  await newQueue().obliterate({ force: true });
  await Promise.all(queues.splice(0).map((queue) => queue.close()));
  await Promise.all(opened.splice(0).map((connection) => connection.quit().catch(() => 0)));
});
afterAll(async () => {
  await redis.stop();
});

describe('exchange-sync scheduler', () => {
  it('booting twice with Binance configured leaves exactly one exchange-sync scheduler, in UTC', async () => {
    const schedules = schedulesFor({ exchangeSync: true });
    await registerSchedules(newQueue(), schedules);
    await registerSchedules(newQueue(), schedules);

    const found = await newQueue().getJobSchedulers();

    expect(found.filter((s) => s.key === 'exchange-sync')).toHaveLength(1);
    expect(found.find((s) => s.key === 'exchange-sync')).toMatchObject({
      name: 'exchange-sync',
      pattern: EXCHANGE_SYNC_SCHEDULE.pattern,
      tz: 'UTC',
    });
    expect(found).toHaveLength(schedules.length);
  });

  it('is not registered while Binance is off, and a stale scheduler is removed', async () => {
    const queue = newQueue();
    await registerSchedules(queue, schedulesFor({ exchangeSync: true }));
    expect((await queue.getJobSchedulers()).map((s) => s.key)).toContain('exchange-sync');

    await registerSchedules(queue, schedulesFor({ exchangeSync: false }));

    expect((await queue.getJobSchedulers()).map((s) => s.key)).not.toContain('exchange-sync');
  });
});
