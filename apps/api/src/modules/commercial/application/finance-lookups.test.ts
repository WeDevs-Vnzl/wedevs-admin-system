import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryFinanceLookupsSource } from '../../../../test/commercial/finance-lookups/fakes/in-memory-finance-lookups.source';
import { FinanceLookups } from './finance-lookups';

const project = (id: string, clientIds: string[], archived = false) => ({
  id,
  code: `PRY-${id}`,
  name: `Project ${id}`,
  status: 'EN_CURSO' as const,
  clientIds,
  archived,
});

describe('FinanceLookups', () => {
  let source: InMemoryFinanceLookupsSource;
  let lookups: FinanceLookups;

  beforeEach(() => {
    source = new InMemoryFinanceLookupsSource();
    source.clients.set('c1', { id: 'c1', code: 'CLI-1', tradeName: 'Kairos', archived: false });
    source.clients.set('c2', { id: 'c2', code: 'CLI-2', tradeName: 'Old', archived: true });
    source.projects.set('p1', project('p1', ['c1']));
    source.projects.set('p2', project('p2', ['c1', 'c3']));
    source.projects.set('p3', project('p3', ['c1'], true));
    source.users.set('u1', { id: 'u1', name: 'Ana', role: 'OWNER', archived: false });
    source.users.set('u2', { id: 'u2', name: 'Gone', role: 'ADMIN', archived: true });
    lookups = new FinanceLookups(source);
  });

  it('liveClientRef returns the reference of a live client and null for archived or unknown', async () => {
    expect(await lookups.liveClientRef('c1')).toEqual({
      type: 'CLIENT',
      id: 'c1',
      code: 'CLI-1',
      label: 'Kairos',
    });
    expect(await lookups.liveClientRef('c2')).toBeNull();
    expect(await lookups.liveClientRef('nope')).toBeNull();
  });

  it('liveProject returns the live project with its status and clients, null otherwise', async () => {
    expect(await lookups.liveProject('p2')).toEqual({
      ref: { type: 'PROJECT', id: 'p2', code: 'PRY-p2', label: 'Project p2' },
      status: 'EN_CURSO',
      clientIds: ['c1', 'c3'],
    });
    expect(await lookups.liveProject('p3')).toBeNull();
    expect(await lookups.liveProject('nope')).toBeNull();
  });

  it('projectBelongsToClient requires a live project linked to the client', async () => {
    expect(await lookups.projectBelongsToClient('p1', 'c1')).toBe(true);
    expect(await lookups.projectBelongsToClient('p1', 'c3')).toBe(false);
    expect(await lookups.projectBelongsToClient('p3', 'c1')).toBe(false);
    expect(await lookups.projectBelongsToClient('nope', 'c1')).toBe(false);
  });

  it('liveProjectsOfClient lists only live projects of the client', async () => {
    const found = await lookups.liveProjectsOfClient('c1');
    expect(found.map((p) => p.ref.id)).toEqual(['p1', 'p2']);
    expect(await lookups.liveProjectsOfClient('c9')).toEqual([]);
  });

  it('partnerRef returns an active user and null for archived or unknown', async () => {
    expect(await lookups.partnerRef('u1')).toEqual({ id: 'u1', label: 'Ana', role: 'OWNER' });
    expect(await lookups.partnerRef('u2')).toBeNull();
    expect(await lookups.partnerRef('nope')).toBeNull();
  });
});
