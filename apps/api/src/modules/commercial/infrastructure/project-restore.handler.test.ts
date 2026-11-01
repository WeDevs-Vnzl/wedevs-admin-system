import { describe, expect, it } from 'vitest';
import {
  actor,
  projectRecord,
  projectWorld,
} from '../../../../test/commercial/projects/fakes/world';
import { NotFoundError } from '../../../shared/domain/domain-error';
import { RestoreHandlerRegistry } from '../../platform/application/restore-handler.registry';
import { ProjectRestoreHandler } from './project-restore.handler';

describe('ProjectRestoreHandler', () => {
  it('is the PROJECT handler of the trash, governed by the project resource', () => {
    const handler = new ProjectRestoreHandler(projectWorld().restoreProject);
    expect(handler.entityType).toBe('PROJECT');
    expect(handler.resource).toBe('project');
    const registry = new RestoreHandlerRegistry();
    registry.register(handler);
    expect(registry.get('PROJECT')).toBe(handler);
  });

  it('restores through the use case and returns the entity ref', async () => {
    const world = projectWorld();
    world.projects.seed(projectRecord({ archivedAt: new Date('2026-03-01Z') }));
    const handler = new ProjectRestoreHandler(world.restoreProject);
    expect(await handler.restore(actor('OWNER'), 'pry_kairos_web')).toEqual({
      type: 'PROJECT',
      id: 'pry_kairos_web',
      code: 'PRY-0001',
      label: 'Sitio Kairós',
    });
    expect(world.projects.get('pry_kairos_web')?.archivedAt).toBeNull();
  });

  it('propagates the use case errors (an unknown or live project is NOT_FOUND)', async () => {
    const world = projectWorld();
    world.projects.seed(projectRecord());
    const handler = new ProjectRestoreHandler(world.restoreProject);
    await expect(handler.restore(actor('OWNER'), 'pry_kairos_web')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
