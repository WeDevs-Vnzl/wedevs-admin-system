import { describe, expect, it } from 'vitest';
import { GRAPH_EXPANSION_LIMIT, graphNodeId } from '../../../src/modules/intelligence/domain';
import type { GraphResponse } from '../../../src/modules/intelligence/application/use-cases/graph/graph-output';
import { buildWorld, userOf } from './world';

const owner = userOf('OWNER');
const admin = userOf('ADMIN');
const member = userOf('MEMBER');
const viewer = userOf('VIEWER');

const ids = (response: GraphResponse) => response.nodes.map((node) => node.id).sort();
const typesOf = (response: GraphResponse) => new Set(response.nodes.map((node) => node.type));
const node = (type: Parameters<typeof graphNodeId>[0], id: string) => graphNodeId(type, id);

describe('GetEntityGraph', () => {
  it('HU-24 CA1: the client root with its direct neighbours; tags and technologies stay hidden', async () => {
    const { getEntityGraph, refs } = buildWorld();
    const graph = await getEntityGraph.execute(owner, { type: 'CLIENT', id: refs.kairos.id });
    const root = node('CLIENT', 'cli_kairos');
    expect(ids(graph)).toEqual(
      [
        root,
        node('CONTACT', 'con_ana'),
        node('PROJECT', 'pry_app'),
        node('PROJECT', 'pry_erp'),
        node('INVOICE', 'inv_1'),
        node('PAYMENT', 'pay_1'),
        node('DOCUMENT', 'doc_1'),
        node('NOTE', 'not_1'),
      ].sort(),
    );
    expect(graph.edges.every((edge) => edge.source === root || edge.target === root)).toBe(true);
    expect(typesOf(graph).has('TAG')).toBe(false);
    expect(typesOf(graph).has('TECHNOLOGY')).toBe(false);
    expect(graph.truncated).toEqual([]);
  });

  it('keeps the edge direction of PRD 8.12.3 and labels `participa` with the role', async () => {
    const { getEntityGraph } = buildWorld();
    const graph = await getEntityGraph.execute(owner, { type: 'CLIENT', id: 'cli_kairos' });
    expect(graph.edges.find((edge) => edge.target === node('PROJECT', 'pry_app'))).toEqual({
      id: `${node('CLIENT', 'cli_kairos')}|participa|${node('PROJECT', 'pry_app')}`,
      source: node('CLIENT', 'cli_kairos'),
      target: node('PROJECT', 'pry_app'),
      relation: 'participa',
      label: 'Dueño',
    });
    const doc = graph.edges.find((edge) => edge.source === node('DOCUMENT', 'doc_1'));
    expect(doc).toMatchObject({ target: node('CLIENT', 'cli_kairos'), relation: 'adjunto_a' });
    expect(doc).not.toHaveProperty('label');
  });

  it('include narrows the neighbour types and can ask for tags and technologies', async () => {
    const { getEntityGraph } = buildWorld();
    const narrow = await getEntityGraph.execute(owner, {
      type: 'CLIENT',
      id: 'cli_kairos',
      include: ['PROJECT'],
    });
    expect([...typesOf(narrow)].sort()).toEqual(['CLIENT', 'PROJECT']);
    const tags = await getEntityGraph.execute(owner, {
      type: 'PROJECT',
      id: 'pry_app',
      include: ['TAG', 'TECHNOLOGY'],
    });
    expect(ids(tags)).toEqual(
      [node('PROJECT', 'pry_app'), node('TAG', 'tag_prio'), node('TECHNOLOGY', 'tec_next')].sort(),
    );
  });

  it('degree counts every visible relation, whatever include loads', async () => {
    const { getEntityGraph } = buildWorld();
    const everything = await getEntityGraph.execute(owner, {
      type: 'CLIENT',
      id: 'cli_kairos',
      include: ['CONTACT', 'PROJECT', 'INVOICE', 'PAYMENT', 'DOCUMENT', 'NOTE', 'TAG'],
    });
    const narrow = await getEntityGraph.execute(owner, {
      type: 'CLIENT',
      id: 'cli_kairos',
      include: ['PROJECT'],
    });
    const root = node('CLIENT', 'cli_kairos');
    // 1 contact + 2 projects + invoice + payment + document + note + tag (the archived contact is not visible).
    expect(narrow.nodes.find((n) => n.id === root)?.degree).toBe(8);
    expect(everything.nodes.find((n) => n.id === root)?.degree).toBe(8);
    expect(everything.nodes.find((n) => n.id === node('PROJECT', 'pry_app'))?.degree).toBe(
      // 2 clients + invoice + expense + document + tag + technology.
      7,
    );
  });

  it('depth 2 reaches the neighbours of the neighbours; depth is checked by the use case', async () => {
    const { getEntityGraph } = buildWorld();
    const two = await getEntityGraph.execute(owner, { type: 'CLIENT', id: 'cli_kairos', depth: 2 });
    expect(ids(two)).toContain(node('CLIENT', 'cli_mochima'));
    expect(ids(two)).toContain(node('EXPENSE', 'exp_1'));
    for (const depth of [0, 4, 1.5]) {
      await expect(
        getEntityGraph.execute(owner, { type: 'CLIENT', id: 'cli_kairos', depth }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
    }
  });

  it('an unreadable root is FORBIDDEN, an invisible one NOT_FOUND', async () => {
    const { getEntityGraph } = buildWorld();
    await expect(
      getEntityGraph.execute(member, { type: 'INVOICE', id: 'inv_1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // FORBIDDEN wins over existence: a Member cannot probe invoice ids.
    await expect(
      getEntityGraph.execute(member, { type: 'INVOICE', id: 'inv_missing' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      getEntityGraph.execute(owner, { type: 'CLIENT', id: 'cli_missing' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a Member sees no invoice or payment node, and degree excludes them', async () => {
    const { getEntityGraph } = buildWorld();
    const graph = await getEntityGraph.execute(member, { type: 'CLIENT', id: 'cli_kairos' });
    expect(typesOf(graph).has('INVOICE')).toBe(false);
    expect(typesOf(graph).has('PAYMENT')).toBe(false);
    expect(
      graph.edges.some((edge) => edge.relation === 'facturado_a' || edge.relation === 'pago'),
    ).toBe(false);
    // owner degree 8 minus the invoice and the payment
    expect(graph.nodes.find((n) => n.id === node('CLIENT', 'cli_kairos'))?.degree).toBe(6);
  });

  it('a Viewer reads the commercial types but not the financial ones', async () => {
    const { getEntityGraph } = buildWorld();
    const graph = await getEntityGraph.execute(viewer, { type: 'PROJECT', id: 'pry_app' });
    expect(typesOf(graph).has('EXPENSE')).toBe(false);
    expect(typesOf(graph).has('INVOICE')).toBe(false);
    expect(typesOf(graph).has('CLIENT')).toBe(true);
  });

  it('validates type, id and include without the DTO', async () => {
    const { getEntityGraph } = buildWorld();
    await expect(getEntityGraph.execute(owner, { type: 'LEAD', id: 'x' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(
      getEntityGraph.execute(owner, { type: 'CLIENT', id: 'bad id!' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      getEntityGraph.execute(owner, { type: 'CLIENT', id: 'cli_kairos', include: ['LEAD'] }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      getEntityGraph.execute(owner, { type: 'CLIENT', id: 'cli_kairos', include: [] }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

describe('ExpandNode', () => {
  it('HU-24 CA2: a project yields its documents, invoices, expenses and clients', async () => {
    const { expandNode } = buildWorld();
    const graph = await expandNode.execute(owner, { nodeId: node('PROJECT', 'pry_app') });
    expect(ids(graph)).toEqual(
      [
        node('PROJECT', 'pry_app'),
        node('CLIENT', 'cli_kairos'),
        node('CLIENT', 'cli_mochima'),
        node('INVOICE', 'inv_1'),
        node('EXPENSE', 'exp_1'),
        node('DOCUMENT', 'doc_1'),
      ].sort(),
    );
    expect(graph.edges.find((e) => e.source === node('EXPENSE', 'exp_1'))).toMatchObject({
      target: node('PROJECT', 'pry_app'),
      relation: 'imputado_a',
    });
  });

  describe('paging (HU-24 CA5)', () => {
    function withContacts(count: number) {
      const world = buildWorld();
      for (let i = 0; i < count; i += 1) {
        const ref = world.read.add('CONTACT', `con_bulk_${String(i).padStart(3, '0')}`, {
          label: `Contacto ${String(i).padStart(3, '0')}`,
          date: '2026-01-01',
          tagIds: [],
        });
        world.read.link(world.refs.kairos, ref, 'contacto');
      }
      return world;
    }

    it('at most 50 neighbours, the rest as truncated, the cursor loads the next page', async () => {
      const { getEntityGraph, expandNode } = withContacts(60);
      const root = node('CLIENT', 'cli_kairos');
      const first = await getEntityGraph.execute(owner, { type: 'CLIENT', id: 'cli_kairos' });
      expect(first.nodes).toHaveLength(1 + GRAPH_EXPANSION_LIMIT);
      // 61 contacts, 2 projects, invoice, payment, document and note, minus the first page.
      expect(first.truncated).toEqual([{ nodeId: root, remaining: 17, cursor: '50' }]);
      const remaining = first.truncated[0]?.remaining ?? 0;
      expect(remaining).toBeGreaterThan(0);

      const second = await expandNode.execute(owner, { nodeId: root, cursor: '50' });
      expect(second.truncated).toEqual([]);
      const neighbours = (r: GraphResponse) =>
        r.nodes.filter((n) => n.id !== root).map((n) => n.id);
      expect(neighbours(second)).toHaveLength(remaining);
      const all = new Set([...neighbours(first), ...neighbours(second)]);
      expect(all.size).toBe(GRAPH_EXPANSION_LIMIT + remaining);
    });

    it('orders neighbours by type, label and id, and expandNode pages without a cursor', async () => {
      const { expandNode } = withContacts(60);
      const graph = await expandNode.execute(owner, { nodeId: node('CLIENT', 'cli_kairos') });
      const neighbours = graph.nodes.filter((n) => n.id !== node('CLIENT', 'cli_kairos'));
      expect(neighbours).toHaveLength(GRAPH_EXPANSION_LIMIT);
      // Contacts come first (contract order) and by label: Ana, then Contacto 000...
      expect(neighbours[0]?.id).toBe(node('CONTACT', 'con_ana'));
      expect(neighbours[1]?.id).toBe(node('CONTACT', 'con_bulk_000'));
    });

    it('reads a 50-neighbour page with a number of port calls that does not grow with the page', async () => {
      const small = withContacts(60);
      await small.expandNode.execute(owner, { nodeId: node('CLIENT', 'cli_kairos') });
      const big = withContacts(120);
      await big.expandNode.execute(owner, { nodeId: node('CLIENT', 'cli_kairos') });
      expect(big.read.totalCalls).toBe(small.read.totalCalls);
      expect(big.read.totalCalls).toBeLessThanOrEqual(6);
    });
  });

  it('rejects an invalid cursor, node id and include', async () => {
    const { expandNode } = buildWorld();
    for (const cursor of ['abc', '-1', '1.5', '9'.repeat(400)]) {
      await expect(
        expandNode.execute(owner, { nodeId: node('CLIENT', 'cli_kairos'), cursor }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
    }
    await expect(expandNode.execute(owner, { nodeId: 'nonsense' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(
      expandNode.execute(owner, { nodeId: node('CLIENT', 'cli_kairos'), include: ['LEAD'] }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('unknown node is NOT_FOUND and an unreadable one FORBIDDEN', async () => {
    const { expandNode } = buildWorld();
    await expect(
      expandNode.execute(owner, { nodeId: node('PROJECT', 'pry_missing') }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      expandNode.execute(viewer, { nodeId: node('INVOICE', 'inv_1') }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('archived nodes (HU-28 CA1)', () => {
  const kairos = node('CLIENT', 'cli_kairos');
  const archived = node('CONTACT', 'con_old');

  it('are excluded unless includeArchived is set, by getEntityGraph and expandNode', async () => {
    const { getEntityGraph, expandNode } = buildWorld();
    expect(
      ids(await getEntityGraph.execute(owner, { type: 'CLIENT', id: 'cli_kairos' })),
    ).not.toContain(archived);
    const shown = await getEntityGraph.execute(owner, {
      type: 'CLIENT',
      id: 'cli_kairos',
      includeArchived: true,
    });
    expect(shown.nodes.find((n) => n.id === archived)?.archived).toBe(true);
    expect(ids(await expandNode.execute(owner, { nodeId: kairos }))).not.toContain(archived);
    expect(
      ids(await expandNode.execute(owner, { nodeId: kairos, includeArchived: true })),
    ).toContain(archived);
  });

  it('degree counts an archived relation only when the toggle shows it', async () => {
    const { getEntityGraph } = buildWorld();
    const hidden = await getEntityGraph.execute(owner, { type: 'CLIENT', id: 'cli_kairos' });
    const shown = await getEntityGraph.execute(admin, {
      type: 'CLIENT',
      id: 'cli_kairos',
      includeArchived: true,
    });
    const degreeOf = (r: GraphResponse) => r.nodes.find((n) => n.id === kairos)?.degree ?? 0;
    expect(degreeOf(shown)).toBe(degreeOf(hidden) + 1);
  });

  it('need the trash grant even with the toggle', async () => {
    const { getEntityGraph, expandNode } = buildWorld();
    const graph = await getEntityGraph.execute(member, {
      type: 'CLIENT',
      id: 'cli_kairos',
      includeArchived: true,
    });
    expect(ids(graph)).not.toContain(archived);
    expect(
      ids(await expandNode.execute(member, { nodeId: kairos, includeArchived: true })),
    ).not.toContain(archived);
  });

  it('an archived root is NOT_FOUND without the trash grant and shown with it', async () => {
    const { getEntityGraph } = buildWorld();
    await expect(
      getEntityGraph.execute(member, { type: 'CLIENT', id: 'cli_old' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const graph = await getEntityGraph.execute(owner, {
      type: 'CLIENT',
      id: 'cli_old',
      includeArchived: true,
    });
    expect(graph.nodes.find((n) => n.id === node('CLIENT', 'cli_old'))?.archived).toBe(true);
  });
});

describe('GetGlobalGraph', () => {
  it('HU-25 CA1: clients, projects and documents by default, archived excluded, with stats', async () => {
    const { getGlobalGraph } = buildWorld();
    const graph = await getGlobalGraph.execute(owner, {});
    expect(ids(graph)).toEqual(
      [
        node('CLIENT', 'cli_kairos'),
        node('CLIENT', 'cli_mochima'),
        node('PROJECT', 'pry_app'),
        node('PROJECT', 'pry_erp'),
        node('DOCUMENT', 'doc_1'),
      ].sort(),
    );
    const nodeIds = new Set(graph.nodes.map((n) => n.id));
    expect(graph.edges.length).toBeGreaterThan(0);
    expect(graph.edges.every((e) => nodeIds.has(e.source) && nodeIds.has(e.target))).toBe(true);
    expect(graph.truncated).toEqual([]);
    expect(graph.stats.nodeCount).toBe(5);
    expect(graph.stats.edgeCount).toBe(graph.edges.length);
    expect(graph.stats.mostConnected[0]).toMatchObject({ nodeId: node('CLIENT', 'cli_kairos') });
    const degrees = graph.stats.mostConnected.map((item) => item.degree);
    expect([...degrees].sort((a, b) => b - a)).toEqual(degrees);
  });

  it('includeArchived shows archived nodes to Owner and Admin only; onlyActive overrides it', async () => {
    const { getGlobalGraph } = buildWorld();
    const shown = await getGlobalGraph.execute(owner, { filters: { includeArchived: true } });
    expect(ids(shown)).toContain(node('CLIENT', 'cli_old'));
    const member1 = await getGlobalGraph.execute(member, { filters: { includeArchived: true } });
    expect(ids(member1)).not.toContain(node('CLIENT', 'cli_old'));
    const active = await getGlobalGraph.execute(owner, {
      filters: { includeArchived: true, onlyActive: true },
    });
    expect(ids(active)).not.toContain(node('CLIENT', 'cli_old'));
  });

  it('onlyActive hides inactive clients and finished projects', async () => {
    const { getGlobalGraph } = buildWorld();
    const graph = await getGlobalGraph.execute(owner, { filters: { onlyActive: true } });
    expect(graph.nodes.some((n) => n.status === 'INACTIVO' || n.status === 'ENTREGADO')).toBe(
      false,
    );
    expect(graph.nodes.filter((n) => n.type === 'CLIENT')).toHaveLength(1);
  });

  it('statuses, technologyIds, tagIds and date range narrow the nodes', async () => {
    const { getGlobalGraph } = buildWorld();
    const status = await getGlobalGraph.execute(owner, {
      include: ['PROJECT'],
      filters: { statuses: ['EN_CURSO'] },
    });
    expect(ids(status)).toEqual([node('PROJECT', 'pry_app')]);
    const tech = await getGlobalGraph.execute(owner, {
      include: ['PROJECT'],
      filters: { technologyIds: ['tec_next'] },
    });
    expect(ids(tech)).toEqual([node('PROJECT', 'pry_app')]);
    const tag = await getGlobalGraph.execute(owner, {
      include: ['PROJECT', 'CLIENT'],
      filters: { tagIds: ['tag_prio'] },
    });
    expect(ids(tag)).toEqual([node('CLIENT', 'cli_kairos'), node('PROJECT', 'pry_app')].sort());
    const range = await getGlobalGraph.execute(owner, {
      include: ['PROJECT'],
      filters: { dateFrom: '2026-07-01', dateTo: '2026-07-31' },
    });
    expect(ids(range)).toEqual([node('PROJECT', 'pry_app')]);
  });

  it('clientIds keep those clients, their projects and the documents linked to them', async () => {
    const { getGlobalGraph } = buildWorld();
    const graph = await getGlobalGraph.execute(owner, { filters: { clientIds: ['cli_mochima'] } });
    expect(ids(graph)).toEqual(
      [node('CLIENT', 'cli_mochima'), node('PROJECT', 'pry_app'), node('DOCUMENT', 'doc_1')].sort(),
    );
  });

  it('drops the types the caller cannot read and never fails for them', async () => {
    const { getGlobalGraph, read } = buildWorld();
    const graph = await getGlobalGraph.execute(viewer, { include: ['CLIENT', 'INVOICE'] });
    expect([...typesOf(graph)]).toEqual(['CLIENT']);
    expect(read.calls.listFacts).toBe(1);
  });

  it('technologies and tags are catalog nodes any signed-in user sees', async () => {
    const { getGlobalGraph } = buildWorld();
    const graph = await getGlobalGraph.execute(viewer, { include: ['TAG', 'TECHNOLOGY'] });
    expect([...typesOf(graph)].sort()).toEqual(['TAG', 'TECHNOLOGY']);
  });

  it('validates include and filters without the DTO', async () => {
    const { getGlobalGraph } = buildWorld();
    await expect(getGlobalGraph.execute(owner, { include: ['LEAD'] })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(getGlobalGraph.execute(owner, { include: [] })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(
      getGlobalGraph.execute(owner, { filters: { dateFrom: '2026-02-30' } }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      getGlobalGraph.execute(owner, { filters: { dateFrom: '2026-08-01', dateTo: '2026-07-01' } }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
