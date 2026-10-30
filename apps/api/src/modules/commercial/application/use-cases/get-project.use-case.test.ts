import { describe, expect, it } from 'vitest';
import {
  actor,
  KAIROS,
  NEXT_JS,
  projectRecord,
  projectWorld,
} from '../../../../../test/commercial/projects/fakes/world';
import { NotFoundError } from '../../../../shared/domain/domain-error';

describe('GetProject (mock getProject)', () => {
  it('assembles the detail with chips and refs, sorted links, and NOT_FOUND for an unknown id', async () => {
    const world = projectWorld();
    world.seedTag('tag_a', 'Urgente');
    world.projects.seed(
      projectRecord({
        technologyIds: [NEXT_JS.id],
        links: [
          { id: 'l2', group: 'ENTORNO', label: 'Prod', url: 'https://p.test', order: 0 },
          { id: 'l1', group: 'REPOSITORIO', label: 'Repo', url: 'https://r.test', order: 0 },
        ],
      }),
    );
    world.billing.plans.add('pry_kairos_web');
    world.projects.setMetrics('pry_kairos_web', {
      contractedValueUsd: '900.00',
      invoicedUsd: '0.00',
      collectedUsd: '0.00',
      toInvoiceUsd: '900.00',
    });

    const detail = await world.getProject.execute(actor('OWNER'), 'pry_kairos_web');
    expect(detail).toMatchObject({
      code: 'PRY-0001',
      summary: 'Sitio corporativo',
      clients: [{ client: { id: KAIROS }, role: 'Contratante' }],
      stack: [{ id: NEXT_JS.id }],
      contractedValueUsd: '900.00',
      hasBillingPlan: true,
    });
    expect(detail.links.map((l) => l.id)).toEqual(['l1', 'l2']);

    await expect(world.getProject.execute(actor('OWNER'), 'pry_ghost')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('answers NOT_FOUND to an archived project unless the role can restore (C19)', async () => {
    const world = projectWorld();
    world.projects.seed(projectRecord({ archivedAt: new Date('2026-03-01Z') }));
    for (const role of ['MEMBER', 'VIEWER'] as const) {
      await expect(world.getProject.execute(actor(role), 'pry_kairos_web')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    }
    for (const role of ['OWNER', 'ADMIN'] as const) {
      const detail = await world.getProject.execute(actor(role), 'pry_kairos_web');
      expect(detail.archivedAt).toEqual(new Date('2026-03-01Z'));
    }
  });
});
