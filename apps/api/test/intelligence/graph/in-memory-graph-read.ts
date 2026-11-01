import { graphNodeId } from '../../../src/modules/intelligence/domain';
import type {
  GraphNodeFacts,
  GraphNodeType,
  GraphPresence,
  GraphReadPort,
  GraphReadScope,
  GraphRef,
  GraphRelationKey,
  GraphRelationRow,
} from '../../../src/modules/intelligence/application/ports/graph-read.port';

interface StoredNode {
  readonly ref: GraphRef;
  readonly facts: GraphNodeFacts;
}

interface StoredLink {
  readonly source: GraphRef;
  readonly target: GraphRef;
  readonly relation: GraphRelationKey;
  readonly label?: string;
}

const key = (ref: GraphRef): string => graphNodeId(ref.type, ref.id);

/** In-memory `GraphReadPort`: nodes plus directed links, with a counter per port method. */
export class InMemoryGraphRead implements GraphReadPort {
  private readonly nodes = new Map<string, StoredNode>();
  private readonly links: StoredLink[] = [];
  readonly calls = { facts: 0, presence: 0, relations: 0, listFacts: 0 };

  get totalCalls(): number {
    return this.calls.facts + this.calls.presence + this.calls.relations + this.calls.listFacts;
  }

  add(
    type: GraphNodeType,
    id: string,
    facts: Partial<GraphNodeFacts> & { label: string },
  ): GraphRef {
    const ref: GraphRef = { type, id };
    this.nodes.set(key(ref), {
      ref,
      facts: { meta: {}, archived: false, date: null, ...facts },
    });
    return ref;
  }

  archive(ref: GraphRef): void {
    const node = this.nodes.get(key(ref));
    if (node) this.nodes.set(key(ref), { ref, facts: { ...node.facts, archived: true } });
  }

  link(source: GraphRef, target: GraphRef, relation: GraphRelationKey, label?: string): void {
    this.links.push({ source, target, relation, ...(label !== undefined ? { label } : {}) });
  }

  facts(refs: readonly GraphRef[], scope: GraphReadScope): Promise<Map<string, GraphNodeFacts>> {
    this.calls.facts += 1;
    const out = new Map<string, GraphNodeFacts>();
    for (const ref of refs) {
      const node = this.nodes.get(key(ref));
      if (node && scope.types.has(ref.type)) out.set(key(ref), node.facts);
    }
    return Promise.resolve(out);
  }

  presence(refs: readonly GraphRef[], scope: GraphReadScope): Promise<Map<string, GraphPresence>> {
    this.calls.presence += 1;
    const out = new Map<string, GraphPresence>();
    for (const ref of refs) {
      const node = this.nodes.get(key(ref));
      if (node && scope.types.has(ref.type)) out.set(key(ref), { archived: node.facts.archived });
    }
    return Promise.resolve(out);
  }

  relations(
    refs: readonly GraphRef[],
    scope: GraphReadScope,
  ): Promise<Map<string, GraphRelationRow[]>> {
    this.calls.relations += 1;
    const out = new Map<string, GraphRelationRow[]>();
    for (const ref of refs) {
      const rows: GraphRelationRow[] = [];
      for (const link of this.links) {
        const outgoing = key(link.source) === key(ref);
        if (!outgoing && key(link.target) !== key(ref)) continue;
        const other = outgoing ? link.target : link.source;
        if (!scope.types.has(other.type)) continue;
        rows.push({
          other,
          relation: link.relation,
          outgoing,
          ...(link.label !== undefined ? { label: link.label } : {}),
        });
      }
      if (rows.length > 0) out.set(key(ref), rows);
    }
    return Promise.resolve(out);
  }

  listFacts(
    type: GraphNodeType,
    scope: GraphReadScope,
    options: { readonly includeArchived: boolean },
  ): Promise<{ ref: GraphRef; facts: GraphNodeFacts }[]> {
    this.calls.listFacts += 1;
    if (!scope.types.has(type)) return Promise.resolve([]);
    const rows = [...this.nodes.values()]
      .filter((node) => node.ref.type === type)
      .filter((node) => options.includeArchived || !node.facts.archived)
      .sort((a, b) => a.ref.id.localeCompare(b.ref.id));
    return Promise.resolve(rows.map(({ ref, facts }) => ({ ref, facts })));
  }
}
