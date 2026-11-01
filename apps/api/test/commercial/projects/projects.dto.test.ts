import { describe, expect, it } from 'vitest';
import {
  archiveProjectsSchema,
  createProjectSchema,
  projectListQuerySchema,
  setProjectStatusSchema,
  setProjectTechnologiesSchema,
  updateProjectSchema,
  upsertProjectLinksSchema,
} from '../../../src/modules/commercial/interface/http/dto/projects.dto';

const minimal = { name: 'Sitio', summary: 'Resumen', clients: [{ clientId: 'cli_1' }] };

/** Shape and bounds only: the required/length rules of name and summary are domain rules (422 keys). */
describe('project request DTOs', () => {
  it('create accepts the minimum and applies the defaults (PROPUESTA, no stack, no tags, no links)', () => {
    expect(createProjectSchema.parse(minimal)).toMatchObject({
      status: 'PROPUESTA',
      technologyIds: [],
      tagIds: [],
      links: [],
    });
  });

  it('rejects a repeated client, repeated technology or tag ids and unknown statuses', () => {
    const dup = [{ clientId: 'a' }, { clientId: 'a' }];
    expect(createProjectSchema.safeParse({ ...minimal, clients: dup }).success).toBe(false);
    expect(createProjectSchema.safeParse({ ...minimal, technologyIds: ['t', 't'] }).success).toBe(
      false,
    );
    expect(createProjectSchema.safeParse({ ...minimal, tagIds: ['t', 't'] }).success).toBe(false);
    expect(createProjectSchema.safeParse({ ...minimal, status: 'NOPE' }).success).toBe(false);
  });

  it('lets an empty client list through so the domain answers validation.required on clients', () => {
    expect(createProjectSchema.safeParse({ ...minimal, clients: [] }).success).toBe(true);
    expect(createProjectSchema.safeParse({ name: 'x', summary: 'y' }).success).toBe(false);
  });

  it('accepts dates as YYYY-MM-DD or null and rejects impossible ones', () => {
    expect(
      createProjectSchema.safeParse({ ...minimal, startDate: '2026-02-01', endDate: null }).success,
    ).toBe(true);
    expect(createProjectSchema.safeParse({ ...minimal, startDate: '2026-02-30' }).success).toBe(
      false,
    );
  });

  it('runs the rich-text allowlist on the description and keeps image src out (C4)', () => {
    const script = createProjectSchema.safeParse({
      ...minimal,
      description: { type: 'doc', content: [{ type: 'script' }] },
    });
    expect(script.success).toBe(false);
    const ok = createProjectSchema.parse({
      ...minimal,
      description: { type: 'doc', content: [{ type: 'paragraph' }] },
    });
    expect(ok.description).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });

  it('update has no status or links; set-technologies and bulk archive bound their ids', () => {
    expect(updateProjectSchema.parse(minimal)).not.toHaveProperty('status');
    expect(setProjectTechnologiesSchema.safeParse({ technologyIds: ['a', 'a'] }).success).toBe(
      false,
    );
    expect(setProjectTechnologiesSchema.safeParse({ technologyIds: [] }).success).toBe(true);
    expect(archiveProjectsSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(archiveProjectsSchema.safeParse({ ids: ['a', 'a'] }).success).toBe(false);
    expect(archiveProjectsSchema.parse({ ids: ['a'] })).toEqual({ ids: ['a'], confirm: false });
  });

  it('status defaults the cancel options and confirm to false', () => {
    expect(setProjectStatusSchema.parse({ status: 'CANCELADO' })).toEqual({
      status: 'CANCELADO',
      cancelPendingInstallments: false,
      finishRecurringCharges: false,
      confirm: false,
    });
  });

  it('links need at least one entry, a known group and a bounded order', () => {
    const link = { group: 'REPOSITORIO', label: 'Repo', url: 'https://r.test' };
    expect(upsertProjectLinksSchema.parse({ links: [link] }).links[0]?.order).toBe(0);
    expect(upsertProjectLinksSchema.safeParse({ links: [] }).success).toBe(false);
    expect(upsertProjectLinksSchema.safeParse({ links: [{ ...link, group: 'X' }] }).success).toBe(
      false,
    );
    expect(upsertProjectLinksSchema.safeParse({ links: [{ ...link, order: 1001 }] }).success).toBe(
      false,
    );
  });
});

describe('project list query', () => {
  it('defaults to code:desc and parses repeated facets and the delivery window', () => {
    const parsed = projectListQuerySchema.parse({
      status: ['EN_CURSO', 'PAUSADO'],
      clientId: 'cli_1',
      deliveryFrom: '2026-01-01',
    });
    expect(parsed.sort).toEqual({ field: 'code', direction: 'desc' });
    expect(parsed.filters).toEqual({
      status: ['EN_CURSO', 'PAUSADO'],
      clientId: 'cli_1',
      deliveryFrom: '2026-01-01',
    });
  });

  it('accepts withoutBillingPlan=true as an additive facet and nothing else', () => {
    expect(projectListQuerySchema.parse({ withoutBillingPlan: 'true' }).filters).toEqual({
      withoutBillingPlan: 'true',
    });
    expect(projectListQuerySchema.safeParse({ withoutBillingPlan: 'maybe' }).success).toBe(false);
    expect(projectListQuerySchema.parse({}).filters).toEqual({});
  });

  it('whitelists the sort keys: the money ones are accepted here and gated by the use case', () => {
    for (const field of ['code', 'name', 'status', 'createdAt', 'toInvoiceUsd']) {
      expect(projectListQuerySchema.safeParse({ sort: `${field}:asc` }).success).toBe(true);
    }
    expect(projectListQuerySchema.safeParse({ sort: 'summary:asc' }).success).toBe(false);
    expect(projectListQuerySchema.safeParse({ status: 'NOPE' }).success).toBe(false);
  });
});
