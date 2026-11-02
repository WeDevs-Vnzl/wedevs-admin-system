import { Queue, QueueEvents, type Job, type Worker } from 'bullmq';
import IORedis from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createMaintenanceWorker,
  MAINTENANCE_QUEUE,
  type MaintenanceHandlers,
} from '../../src/modules/jobs/interface/jobs/maintenance.processor';
import { registerSchedules, SCHEDULES } from '../../src/modules/jobs/interface/jobs/schedules';
import { startWorker } from '../../src/worker.module';
import { startRedis, type RedisContainer } from '../support/redis-container';
import { applyTestEnv } from '../support/test-env';

/**
 * The BullMQ side against a real Redis (DT-152, A3, A5): schedulers, single execution with two workers up,
 * retry by policy and a stalled job. Nothing here asserts a wall-clock time: every wait is on an event.
 */
let redis: RedisContainer;
const opened: IORedis[] = [];
const workers: Worker[] = [];
const queues: Queue[] = [];
const events: QueueEvents[] = [];

const connect = () => {
  const connection = new IORedis(redis.url, { maxRetriesPerRequest: null });
  opened.push(connection);
  return connection;
};
const newQueue = () => {
  const queue = new Queue(MAINTENANCE_QUEUE, { connection: connect() });
  queues.push(queue);
  return queue;
};
const newEvents = () => {
  const queueEvents = new QueueEvents(MAINTENANCE_QUEUE, { connection: connect() });
  events.push(queueEvents);
  return queueEvents;
};

function handlers(execute: () => Promise<unknown>): MaintenanceHandlers {
  return {
    'daily-maintenance': { execute },
    retention: { execute },
    'cleanup-files': { execute },
  };
}

beforeAll(async () => {
  redis = await startRedis();
}, 120_000);
afterEach(async () => {
  await Promise.all(workers.splice(0).map((worker) => worker.close(true)));
  await Promise.all(events.splice(0).map((e) => e.close()));
  // A fresh queue per test: drop everything the test left in Redis.
  const cleaner = newQueue();
  await cleaner.obliterate({ force: true });
  await Promise.all(queues.splice(0).map((queue) => queue.close()));
  await Promise.all(opened.splice(0).map((connection) => connection.quit().catch(() => 0)));
});
afterAll(async () => {
  await redis.stop();
});

describe('schedulers', () => {
  it('booting twice leaves one scheduler per job, in UTC with the planned cron', async () => {
    await registerSchedules(newQueue());
    await registerSchedules(newQueue());

    const schedulers = await newQueue().getJobSchedulers();

    expect(schedulers.map((s) => s.key).sort()).toEqual(SCHEDULES.map((s) => s.name).sort());
    for (const schedule of SCHEDULES) {
      expect(schedulers.find((s) => s.key === schedule.name)).toMatchObject({
        name: schedule.name,
        pattern: schedule.pattern,
        tz: 'UTC',
      });
    }
  });

  it('removes a scheduler that is no longer listed', async () => {
    const queue = newQueue();
    await queue.upsertJobScheduler('alerts', { pattern: '0 * * * *' }, { name: 'alerts' });
    expect(await queue.getJobSchedulersCount()).toBe(1);

    await registerSchedules(queue);

    const keys = (await queue.getJobSchedulers()).map((s) => s.key);
    expect(keys).not.toContain('alerts');
    expect(keys).toHaveLength(SCHEDULES.length);
  });

  it('the registered template carries the retry policy and a bounded history', async () => {
    const queue = newQueue();
    await registerSchedules(queue);

    const [job] = await queue.getDelayed(0, 0);

    expect(job?.opts).toMatchObject({
      attempts: 3,
      backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: { count: 30 },
      removeOnFail: { count: 100 },
    });
  });
});

describe('execution', () => {
  it('a due job runs once with two workers up', async () => {
    let runs = 0;
    const run = () => {
      runs += 1;
      return Promise.resolve();
    };
    workers.push(createMaintenanceWorker(connect(), handlers(run)));
    workers.push(createMaintenanceWorker(connect(), handlers(run)));
    const queue = newQueue();
    const queueEvents = newEvents();
    await queueEvents.waitUntilReady();

    const job = await queue.add('retention', {});
    await job.waitUntilFinished(queueEvents);

    expect(runs).toBe(1);
    expect(await job.getState()).toBe('completed');
  });

  it('dispatches by name and fails an unknown job', async () => {
    const seen: string[] = [];
    const named = (name: string) => ({
      execute: () => {
        seen.push(name);
        return Promise.resolve();
      },
    });
    workers.push(
      createMaintenanceWorker(connect(), {
        'daily-maintenance': named('daily'),
        retention: named('retention'),
        'cleanup-files': named('cleanup'),
      }),
    );
    const queue = newQueue();
    const queueEvents = newEvents();
    await queueEvents.waitUntilReady();

    await (await queue.add('cleanup-files', {})).waitUntilFinished(queueEvents);
    const unknown = await queue.add('recompute-all', {}, { attempts: 1 });
    await expect(unknown.waitUntilFinished(queueEvents)).rejects.toThrow(
      'Unknown maintenance job: recompute-all',
    );

    expect(seen).toEqual(['cleanup']);
  });

  it('retries a failed job by policy until it succeeds', async () => {
    let calls = 0;
    workers.push(
      createMaintenanceWorker(
        connect(),
        handlers(() => {
          calls += 1;
          return calls < 3 ? Promise.reject(new Error('transient')) : Promise.resolve();
        }),
      ),
    );
    const queue = newQueue();
    const queueEvents = newEvents();
    await queueEvents.waitUntilReady();

    const job = await queue.add(
      'daily-maintenance',
      {},
      { attempts: 3, backoff: { type: 'exponential', delay: 5 } },
    );
    await job.waitUntilFinished(queueEvents);

    expect(calls).toBe(3);
    expect(await job.getState()).toBe('completed');
  });

  it('gives up after the attempts and keeps the failure', async () => {
    let calls = 0;
    const failures: string[] = [];
    let allReported!: () => void;
    const reported = new Promise<void>((resolve) => (allReported = resolve));
    workers.push(
      createMaintenanceWorker(
        connect(),
        handlers(() => {
          calls += 1;
          return Promise.reject(new Error('down'));
        }),
        {
          onFailed: (_job, error) => {
            failures.push(error.message);
            if (failures.length === 3) allReported();
          },
        },
      ),
    );
    const queue = newQueue();
    const queueEvents = newEvents();
    await queueEvents.waitUntilReady();

    const job = await queue.add(
      'daily-maintenance',
      {},
      { attempts: 3, backoff: { type: 'exponential', delay: 5 } },
    );
    await expect(job.waitUntilFinished(queueEvents)).rejects.toThrow('down');

    await reported; // the worker reports after the queue event
    expect(calls).toBe(3);
    expect(failures).toEqual(['down', 'down', 'down']);
    expect(await job.getState()).toBe('failed');
  });

  it('a stalled job is picked up again by another worker and completes', async () => {
    let starts = 0;
    let completions = 0;
    const hang = new Promise<never>(() => undefined);
    const run = () => {
      starts += 1;
      if (starts === 1) return hang; // the first worker dies holding the job
      completions += 1;
      return Promise.resolve();
    };
    const timing = { lockDuration: 500, stalledInterval: 200 };
    const first = createMaintenanceWorker(connect(), handlers(run), timing);
    workers.push(first);
    const queue = newQueue();
    const queueEvents = newEvents();
    await queueEvents.waitUntilReady();
    const job: Job = await queue.add('retention', {});
    await new Promise<void>((resolve) => {
      const poll = () => (starts === 1 ? resolve() : setImmediate(poll));
      poll();
    });

    await first.close(true); // the process is gone: its lock expires
    workers.push(createMaintenanceWorker(connect(), handlers(run), timing));
    await job.waitUntilFinished(queueEvents);

    expect(starts).toBe(2);
    expect(completions).toBe(1);
    expect(await job.getState()).toBe('completed');
  });
});

describe('worker bootstrap', () => {
  it('startWorker registers the three schedulers in Redis and closes cleanly', async () => {
    applyTestEnv();
    Object.assign(process.env, {
      NODE_ENV: 'test',
      APP_URL: 'http://localhost:3001',
      REDIS_URL: redis.url,
    });

    const context = await startWorker();
    const keys = (await newQueue().getJobSchedulers()).map((s) => s.key).sort();
    await context.close();

    expect(keys).toEqual(SCHEDULES.map((s) => s.name).sort());
  });
});
