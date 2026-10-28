import { beforeEach, describe, expect, it } from 'vitest';
import type { ClientMetricsWriterPort } from '../../../src/shared/application/ports/client-metrics-writer.port';
import type { UnitOfWorkPort } from '../../../src/shared/application/ports/unit-of-work.port';

export interface ClientMetricsHarness {
  readonly uow: UnitOfWorkPort;
  readonly metrics: ClientMetricsWriterPort;
  /** Makes `clientId` an existing client (the adapter's rows hang from `Client`). */
  createClient(clientId: string): Promise<void>;
  /** Writes the receivable money column directly, as BE-3's projector will. */
  seedReceivable(clientId: string, receivableUsd: string): Promise<void>;
  read(clientId: string): Promise<{
    projectCount: number;
    lastActivityAt: Date | null;
    receivableUsd: string;
  } | null>;
}

/** Contract of `ClientMetricsWriterPort`: only `projectCount`/`lastActivityAt`, monotonic, transactional. */
export function clientMetricsWriterContract(
  name: string,
  factory: () => Promise<ClientMetricsHarness> | ClientMetricsHarness,
): void {
  describe(`ClientMetricsWriterPort contract: ${name}`, () => {
    let h: ClientMetricsHarness;
    const t1 = new Date('2026-10-01T10:00:00.000Z');
    const t2 = new Date('2026-10-02T10:00:00.000Z');
    beforeEach(async () => {
      h = await factory();
      await h.createClient('c1');
      await h.createClient('c2');
    });

    it('rejects writes outside a unit of work', async () => {
      await expect(h.metrics.ensure('c1')).rejects.toThrow();
      await expect(h.metrics.setProjectCount('c1', 1)).rejects.toThrow();
      await expect(h.metrics.touchActivity(['c1'], t1)).rejects.toThrow();
    });

    it('ensure creates a row with defaults and is idempotent', async () => {
      await h.uow.run(async () => {
        await h.metrics.ensure('c1');
        await h.metrics.ensure('c1');
      });
      expect(await h.read('c1')).toEqual({
        projectCount: 0,
        lastActivityAt: null,
        receivableUsd: '0.00',
      });
    });

    it('setProjectCount creates or updates the row and rejects a negative count', async () => {
      await h.uow.run(() => h.metrics.setProjectCount('c1', 3));
      await h.uow.run(() => h.metrics.setProjectCount('c1', 2));
      expect((await h.read('c1'))?.projectCount).toBe(2);
      await expect(h.uow.run(() => h.metrics.setProjectCount('c1', -1))).rejects.toThrow();
    });

    it('touchActivity bumps every listed client and never moves back', async () => {
      await h.uow.run(() => h.metrics.touchActivity(['c1', 'c2', 'c1'], t2));
      expect((await h.read('c1'))?.lastActivityAt).toEqual(t2);
      expect((await h.read('c2'))?.lastActivityAt).toEqual(t2);
      await h.uow.run(() => h.metrics.touchActivity(['c1'], t1));
      expect((await h.read('c1'))?.lastActivityAt).toEqual(t2);
    });

    it('touchActivity skips a client that does not exist and accepts an empty list', async () => {
      await h.uow.run(async () => {
        await h.metrics.touchActivity(['ghost'], t1);
        await h.metrics.touchActivity([], t1);
      });
      expect(await h.read('ghost')).toBeNull();
    });

    it('never touches the money columns', async () => {
      await h.uow.run(() => h.metrics.ensure('c1'));
      await h.seedReceivable('c1', '125.50');
      await h.uow.run(async () => {
        await h.metrics.setProjectCount('c1', 4);
        await h.metrics.touchActivity(['c1'], t1);
      });
      expect(await h.read('c1')).toMatchObject({ projectCount: 4, receivableUsd: '125.50' });
    });

    it('rolls back with the unit of work', async () => {
      await expect(
        h.uow.run(async () => {
          await h.metrics.setProjectCount('c1', 5);
          await h.metrics.touchActivity(['c1'], t1);
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');
      expect(await h.read('c1')).toBeNull();
    });
  });
}
