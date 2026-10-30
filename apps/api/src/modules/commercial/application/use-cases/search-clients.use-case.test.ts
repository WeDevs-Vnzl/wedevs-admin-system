import { describe, expect, it } from 'vitest';
import { createWorld } from '../../../../../test/commercial/clients/world';

describe('SearchClients', () => {
  it('returns EntityRefs of live clients matching q, at most the limit', async () => {
    const w = createWorld();
    for (let i = 0; i < 25; i++)
      w.seedClient({ tradeName: `Cliente ${String(i).padStart(2, '0')}` });
    w.seedClient({ id: 'cli_kairos', code: 'CLI-0099', tradeName: 'Kairos Studio' });
    w.seedClient({ tradeName: 'Veredas Digital', deletedAt: new Date() });

    expect(await w.searchClients.execute(w.viewer, {})).toHaveLength(20);
    expect(await w.searchClients.execute(w.viewer, { limit: 5 })).toHaveLength(5);
    expect(await w.searchClients.execute(w.viewer, { limit: 500 })).toHaveLength(20);
    expect(await w.searchClients.execute(w.viewer, { q: ' kairos ' })).toEqual([
      { type: 'CLIENT', id: 'cli_kairos', code: 'CLI-0099', label: 'Kairos Studio' },
    ]);
    expect(await w.searchClients.execute(w.viewer, { q: 'veredas' })).toEqual([]);
  });
});
