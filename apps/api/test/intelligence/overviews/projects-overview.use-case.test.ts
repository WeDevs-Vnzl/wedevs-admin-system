import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../../../src/shared/domain/domain-error';
import { PROJECT_STATUS_VALUES } from '../../../src/shared/domain/enums';
import { GetProjectsOverview } from '../../../src/modules/intelligence/application/use-cases/overviews/get-projects-overview.use-case';
import type { ProjectListRowView } from '../../../src/modules/commercial/application/use-cases/project-views';
import { authorization, FakeListSource, projectRow, TODAY, userOf, world } from './world';

function build() {
  const w = world();
  const projects = new FakeListSource<ProjectListRowView>();
  const useCase = new GetProjectsOverview(authorization, projects, w.metrics, w.overview, w.clock);
  return { ...w, projects, useCase };
}

describe('GetProjectsOverview', () => {
  it('counts live projects by status, every status present', async () => {
    const { metrics, useCase } = build();
    metrics.addProject({ id: 'a', name: 'A', status: 'EN_CURSO' });
    metrics.addProject({ id: 'b', name: 'B', status: 'EN_CURSO' });
    metrics.addProject({ id: 'c', name: 'C', status: 'ENTREGADO' });
    metrics.addProject({ id: 'd', name: 'D', status: 'PAUSADO', archived: true });

    const overview = await useCase.execute(userOf('OWNER'));

    expect(overview.countByStatus).toMatchObject({ EN_CURSO: 2, ENTREGADO: 1, PAUSADO: 0 });
    expect(Object.keys(overview.countByStatus)).toHaveLength(PROJECT_STATUS_VALUES.length);
  });

  it('asks the owner for upcoming deliveries: running or paused, due today or later, soonest first', async () => {
    const { projects, useCase } = build();
    projects.items = [projectRow('p1'), projectRow('p2')];

    const overview = await useCase.execute(userOf('OWNER'));

    const query = projects.queries[0]?.query;
    expect(query).toMatchObject({
      sort: { field: 'targetEndDate', direction: 'asc' },
      archived: 'exclude',
      filters: { status: ['EN_CURSO', 'PAUSADO'], deliveryFrom: TODAY },
    });
    expect(overview.upcomingDeliveries.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('asks the owner for projects without a billing plan by code, and keeps five', async () => {
    const { projects, useCase } = build();
    projects.items = Array.from({ length: 7 }, (_, i) => projectRow(`p${i}`));

    const overview = await useCase.execute(userOf('OWNER'));

    expect(projects.queries[1]?.query).toMatchObject({
      sort: { field: 'code', direction: 'asc' },
      filters: { withoutBillingPlan: 'true' },
    });
    expect(overview.withoutBillingPlan).toHaveLength(5);
  });

  it('lists the most used technologies, as many as the read port returns up to eight', async () => {
    const { overview: read, useCase } = build();
    read.technologies = Array.from({ length: 10 }, (_, i) => ({
      id: `t${i}`,
      name: `T${i}`,
      nameEn: null,
      category: 'FRAMEWORK',
      iconSlug: null,
      color: null,
      projectCount: 10 - i,
    }));
    const overview = await useCase.execute(userOf('OWNER'));
    expect(overview.topTechnologies.map((t) => t.id)).toEqual([
      't0',
      't1',
      't2',
      't3',
      't4',
      't5',
      't6',
      't7',
    ]);
  });

  it('highestToInvoice keeps the five projects with something to invoice, the largest first', async () => {
    const { projects, useCase } = build();
    projects.items = [
      projectRow('big', { toInvoiceUsd: '900.00' }),
      projectRow('mid', { toInvoiceUsd: '90.50' }),
      projectRow('zero', { toInvoiceUsd: '0.00' }),
    ];

    const overview = await useCase.execute(userOf('ADMIN'));

    const sorted = projects.queries.find((q) => q.query.sort?.field === 'toInvoiceUsd');
    expect(sorted?.query.sort).toEqual({ field: 'toInvoiceUsd', direction: 'desc' });
    expect(overview.highestToInvoice.map((p) => p.id)).toEqual(['big', 'mid']);
  });

  it.each(['MEMBER', 'VIEWER'] as const)(
    '%s gets no project ranked by money: highestToInvoice is empty and no money sort is asked (X15)',
    async (role) => {
      const { projects, useCase } = build();
      projects.items = [projectRow('p1', { toInvoiceUsd: null })];

      const overview = await useCase.execute(userOf(role));

      expect(overview.highestToInvoice).toEqual([]);
      expect(projects.queries.some((q) => q.query.sort?.field === 'toInvoiceUsd')).toBe(false);
      expect(overview.upcomingDeliveries).toHaveLength(1);
    },
  );

  it('is forbidden without read on projects, before any read', async () => {
    const { projects, metrics, overview, clock } = build();
    const denied = new GetProjectsOverview(
      { can: () => false, canSeeFinancials: () => false },
      projects,
      metrics,
      overview,
      clock,
    );
    await expect(denied.execute(userOf('OWNER'))).rejects.toBeInstanceOf(ForbiddenError);
    expect(projects.queries).toEqual([]);
  });
});
