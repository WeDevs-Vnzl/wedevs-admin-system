import { beforeEach, describe, expect, it } from 'vitest';
import type { KernelHarness, KernelHarnessFactory } from './unit-of-work.contract';

/**
 * Contract of `SequencePort`: `<PREFIX>-<value padded to 4>`, valid only inside a unit of work, no
 * consumption on rollback. Expects every sequence to start at 0. `prime` moves a sequence
 * to a given last value so the `CLI-10000` growth case does not need 10 000 calls.
 */
export function sequenceContract(
  name: string,
  factory: KernelHarnessFactory,
  prime: (h: KernelHarness, sequence: 'CLI', value: number) => Promise<void>,
): void {
  describe(`SequencePort contract: ${name}`, () => {
    let h: KernelHarness;
    beforeEach(async () => {
      h = await factory();
    });

    it('rejects next() outside a unit of work', async () => {
      await expect(h.sequence.next('CLI')).rejects.toThrow();
    });

    it('formats <PREFIX>-<value padded to 4> and increments', async () => {
      const codes = await h.uow.run(async () => [
        await h.sequence.next('CLI'),
        await h.sequence.next('CLI'),
        await h.sequence.next('FAC'),
      ]);
      expect(codes).toEqual(['CLI-0001', 'CLI-0002', 'FAC-0001']);
    });

    it('keeps counting across units of work', async () => {
      await h.uow.run(() => h.sequence.next('PRY'));
      const second = await h.uow.run(() => h.sequence.next('PRY'));
      expect(second).toBe('PRY-0002');
    });

    it('does not consume a value on rollback', async () => {
      await expect(
        h.uow.run(async () => {
          expect(await h.sequence.next('GAS')).toBe('GAS-0001');
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');
      expect(await h.uow.run(() => h.sequence.next('GAS'))).toBe('GAS-0001');
    });

    it('keeps growing past 9999 (padding is a minimum)', async () => {
      await prime(h, 'CLI', 9999);
      expect(await h.uow.run(() => h.sequence.next('CLI'))).toBe('CLI-10000');
    });
  });
}
