import { describe, expect, it, vi } from 'vitest';
import { InMemoryExchangeRateRepository } from '../../../../test/finance/rates/fakes/in-memory-exchange-rate.repository';
import { rate } from '../../../../test/finance/rates/world';
import { ManualRateSource } from './manual-rate-source';

describe('ManualRateSource', () => {
  it('prefers BCV on the effective date and exposes every source as an option', async () => {
    const repository = new InMemoryExchangeRateRepository();
    repository.seed(rate('2026-10-09', 'VES', '755.16', 'BCV'));
    repository.seed(rate('2026-10-09', 'VES', '760', 'MANUAL'));
    const found = await new ManualRateSource(repository).getRateFor('2026-10-12', 'VES');
    expect(found).toMatchObject({ source: 'BCV', usdRate: '755.16', isFallback: true });
    expect(found?.options).toHaveLength(2);
  });

  it('answers null without a rate on or before the date', async () => {
    const repository = new InMemoryExchangeRateRepository();
    repository.seed(rate('2026-10-20', 'VES', '800'));
    expect(await new ManualRateSource(repository).getRateFor('2026-10-12', 'VES')).toBeNull();
  });

  it('answers USD as 1 without reading the repository', async () => {
    const repository = new InMemoryExchangeRateRepository();
    const spy = vi.spyOn(repository, 'findEffective');
    expect(await new ManualRateSource(repository).getRateFor('2026-10-12', 'USD')).toMatchObject({
      usdRate: '1',
      source: null,
      options: [],
    });
    expect(spy).not.toHaveBeenCalled();
  });
});
