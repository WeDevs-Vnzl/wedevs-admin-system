import { describe, expect, it } from 'vitest';
import {
  KAIROS,
  projectRecord,
  projectWorld,
  TORNILLO,
} from '../../../../test/commercial/projects/fakes/world';
import { TaggableTargetRegistry } from '../../settings/application/taggable-target.registry';
import { ProjectTaggableResolver } from './project-taggable.resolver';

describe('ProjectTaggableResolver', () => {
  it('registers PROJECT as taggable under the project resource', () => {
    const resolver = new ProjectTaggableResolver(projectWorld().projects);
    const registry = new TaggableTargetRegistry();
    registry.register(resolver);
    expect(registry.has('PROJECT')).toBe(true);
    expect(registry.resolverFor('PROJECT').resource).toBe('project');
  });

  it('resolves a live project to its name and the earliest linked client', async () => {
    const world = projectWorld();
    world.projects.seed(
      projectRecord({
        clients: [
          { clientId: TORNILLO, role: null, linkedAt: new Date('2026-02-01Z') },
          { clientId: KAIROS, role: null, linkedAt: new Date('2026-01-01Z') },
        ],
      }),
    );
    expect(await new ProjectTaggableResolver(world.projects).resolve('pry_kairos_web')).toEqual({
      label: 'Sitio Kairós',
      clientId: KAIROS,
    });
  });

  it('does not resolve an archived or unknown project', async () => {
    const world = projectWorld();
    world.projects.seed(projectRecord({ archivedAt: new Date('2026-03-01Z') }));
    const resolver = new ProjectTaggableResolver(world.projects);
    expect(await resolver.resolve('pry_kairos_web')).toBeNull();
    expect(await resolver.resolve('pry_ghost')).toBeNull();
  });
});
