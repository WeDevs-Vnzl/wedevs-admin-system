import { describe, expect, it } from 'vitest';
import { InMemoryUnitOfWork } from '../../../../test/support/fakes/in-memory-unit-of-work';
import { NEXT_JS, REACT, RUST } from '../../../../test/settings/technologies/fakes/world';
import { InMemoryTechnologyRepository } from '../../../../test/settings/technologies/fakes/in-memory-technology.repository';
import { TechnologyCatalog } from './technology-catalog';

function setup() {
  const uow = new InMemoryUnitOfWork();
  const repository = new InMemoryTechnologyRepository(uow);
  repository.seed(NEXT_JS, RUST, REACT);
  return { catalog: new TechnologyCatalog(repository) };
}

describe('TechnologyCatalog.findByIds', () => {
  it('returns the chip fields and the active flag, so the stack check can refuse inactive ones', async () => {
    const { catalog } = setup();
    await expect(catalog.findByIds([NEXT_JS.id, REACT.id])).resolves.toEqual([
      {
        id: NEXT_JS.id,
        name: 'Next.js',
        nameEn: null,
        category: 'FRONTEND',
        iconSlug: 'nextdotjs',
        color: null,
        active: true,
      },
      {
        id: REACT.id,
        name: 'React',
        nameEn: null,
        category: 'FRONTEND',
        iconSlug: 'react',
        color: null,
        active: false,
      },
    ]);
  });

  it('leaves unknown ids out and answers an empty list for no ids', async () => {
    const { catalog } = setup();
    await expect(catalog.findByIds(['tec_missing', RUST.id])).resolves.toMatchObject([
      { id: RUST.id },
    ]);
    await expect(catalog.findByIds([])).resolves.toEqual([]);
  });

  it('answers each id once even when it is repeated', async () => {
    const { catalog } = setup();
    await expect(catalog.findByIds([RUST.id, RUST.id])).resolves.toHaveLength(1);
  });

  it('never returns the slug, the usage or the time of a technology (chip only)', async () => {
    const { catalog } = setup();
    const [entry] = await catalog.findByIds([RUST.id]);
    expect(Object.keys(entry ?? {}).sort()).toEqual(
      ['active', 'category', 'color', 'iconSlug', 'id', 'name', 'nameEn'].sort(),
    );
  });
});
