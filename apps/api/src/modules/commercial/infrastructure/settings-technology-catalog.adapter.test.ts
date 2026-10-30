import { describe, expect, it } from 'vitest';
import { InMemoryTechnologyRepository } from '../../../../test/settings/technologies/fakes/in-memory-technology.repository';
import { NEXT_JS, REACT } from '../../../../test/settings/technologies/fakes/world';
import { InMemoryUnitOfWork } from '../../../../test/support/fakes/in-memory-unit-of-work';
import { TechnologyCatalog } from '../../settings/application/technology-catalog';
import { SettingsTechnologyCatalogAdapter } from './settings-technology-catalog.adapter';

function setup() {
  const technologies = new InMemoryTechnologyRepository(new InMemoryUnitOfWork());
  technologies.seed(NEXT_JS, REACT);
  return new SettingsTechnologyCatalogAdapter(new TechnologyCatalog(technologies));
}

describe('SettingsTechnologyCatalogAdapter', () => {
  it('maps settings catalog entries, inactive ones included, leaving unknown ids out', async () => {
    const entries = await setup().findByIds([REACT.id, NEXT_JS.id, 'tec_ghost']);
    expect(entries.map((e) => [e.id, e.active]).sort()).toEqual([
      [NEXT_JS.id, true],
      [REACT.id, false],
    ]);
    expect(entries.find((e) => e.id === NEXT_JS.id)).toEqual({
      id: NEXT_JS.id,
      name: 'Next.js',
      nameEn: null,
      category: 'FRONTEND',
      iconSlug: 'nextdotjs',
      color: null,
      active: true,
    });
  });

  it('answers an empty list for no ids', async () => {
    expect(await setup().findByIds([])).toEqual([]);
  });
});
