import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../../../../shared/domain/domain-error';
import {
  actor,
  NEXT_JS,
  technologyWorld,
} from '../../../../../test/settings/technologies/fakes/world';
import { GetTechnology } from './get-technology.use-case';

describe('GetTechnology', () => {
  it('returns one technology with its usage count (mock getTechnology)', async () => {
    const world = technologyWorld();
    const useCase = new GetTechnology(world.technologies, world.usage);
    await expect(useCase.execute(actor('MEMBER'), { id: NEXT_JS.id })).resolves.toEqual({
      ...NEXT_JS,
      usageCount: 2,
    });
  });

  it('answers NOT_FOUND for an unknown id', async () => {
    const world = technologyWorld();
    const useCase = new GetTechnology(world.technologies, world.usage);
    await expect(useCase.execute(actor('OWNER'), { id: 'tec_missing' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
