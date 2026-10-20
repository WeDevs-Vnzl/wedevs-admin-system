// MOCK — graph services of Hito 1 (PRD §8.12, HU-24, HU-25, HU-28 CA1). `fn(ctx, input)`, framework-free
// (C11). Nodes and edges are derived live from the store, one relation rule per row of §8.12.3 (no generic
// edge table, as in Hito 2). Removed with the cross-module aggregate mocks in H2-B6 (data-rules.md §2).
//
// Rules shared by the three services:
//   visibility   a node type needs `read` on its resource (financial nodes: Owner/Admin only); technologies and
//                tags are catalog chips any signed-in user sees. Archived nodes need the trash grant (C19) and
//                the archived toggle; an archived root only needs the grant.
//   relations    `relation` is a stable key the UI translates: contacto, participa (label = role), facturado_a,
//                incluido_en, paga (label = allocated amount in the invoice currency), pago, acreditado_en,
//                pagado_desde, imputado_a, adjunto_a, anotado_en, usa, etiquetado. Edges point as in §8.12.3.
//   degree       every visible relation of the node, of any type, whatever `include` loads.
//   paging       neighbours are ordered by type (contract order), label and id; one page holds at most
//                `GRAPH_EXPANSION_LIMIT`. The rest is reported in `truncated`; `cursor` is the decimal offset of
//                the next neighbour (the number already loaded), so "+N más" calls `expandNode` with it.
//   default      the detail graph loads every type except technologies and tags (hidden by default, §8.12.2).
import { toDateOnly } from "@/lib/dates";
import { compareMoney, sumMoney } from "@/lib/money";
import { VALIDATION_MESSAGES } from "@/lib/validators/common";
import {
  GRAPH_EXPANSION_LIMIT,
  GRAPH_NODE_TYPE_VALUES,
  graphNodeId,
  parseGraphNodeId,
  type ExpandNodeInput,
  type GetEntityGraphInput,
  type GetGlobalGraphInput,
  type GlobalGraphFilters,
  type GraphEdge,
  type GraphNode,
  type GraphNodeType,
  type GraphResponse,
  type GraphTruncated,
} from "@/lib/validators/graph";
import { can, canSeeFinancials, type PermissionResource } from "@/server/auth/permissions";
import { ServiceError, type MockServiceContext } from "../ctx";
import { firstWords, richTextToPlainText } from "../entity-refs";
import type { MockStore } from "../store";

interface Ref {
  type: GraphNodeType;
  id: string;
}

/** One relation seen from a node: the other end, and whether this node is the edge source. */
interface Relation {
  other: Ref;
  relation: string;
  label?: string;
  outgoing: boolean;
}

/** What the filters and the node card need from a stored row. */
interface NodeFacts {
  label: string;
  code?: string;
  status?: string;
  meta: GraphNode["meta"];
  archived: boolean;
  /** Main date (Caracas business day), for the date-range filter. */
  date: string | null;
  /** `null` when the type carries no tags. */
  tagIds: readonly string[] | null;
}

const RESOURCE: Record<GraphNodeType, PermissionResource | null> = {
  CLIENT: "client",
  CONTACT: "contact",
  PROJECT: "project",
  INVOICE: "invoice",
  PAYMENT: "payment",
  EXPENSE: "expense",
  ACCOUNT: "account",
  DOCUMENT: "document",
  NOTE: "note",
  TECHNOLOGY: null,
  TAG: null,
};

const ENTITY_GRAPH_DEFAULT_TYPES: readonly GraphNodeType[] = GRAPH_NODE_TYPE_VALUES.filter(
  (type) => type !== "TECHNOLOGY" && type !== "TAG",
);
const TYPE_ORDER = new Map<GraphNodeType, number>(
  GRAPH_NODE_TYPE_VALUES.map((type, index) => [type, index]),
);
const FINISHED_PROJECT_STATUSES: ReadonlySet<string> = new Set(["ENTREGADO", "CANCELADO"]);
const ATTACHABLE_TYPES: ReadonlySet<GraphNodeType> = new Set([
  "CLIENT",
  "CONTACT",
  "PROJECT",
  "INVOICE",
  "PAYMENT",
  "EXPENSE",
  "DOCUMENT",
]);
const STACK_ICONS = 4;

const dayOf = (timestamp: string): string => toDateOnly(new Date(timestamp));
const nodeIdOf = (ref: Ref): string => graphNodeId(ref.type, ref.id);

// ───────────────────────────── Per-call view of the store ─────────────────────────────

/**
 * The store as the caller sees it during one call: rows indexed by id, relations and facts memoized, and
 * the visibility rules of the caller applied.
 */
class GraphView {
  private readonly rows = new Map<GraphNodeType, Map<string, unknown>>();
  private readonly factsCache = new Map<string, NodeFacts | null>();
  private readonly relationsCache = new Map<string, Relation[]>();
  readonly financials: boolean;
  readonly seesArchived: boolean;

  constructor(
    readonly ctx: MockServiceContext,
    /** Whether archived neighbours are shown (the archived toggle, already checked against the grant). */
    readonly showArchived: boolean,
  ) {
    const { db } = ctx;
    this.financials = canSeeFinancials(ctx.user);
    this.seesArchived = can(ctx.user, "restore", "trash");
    const index = <T extends { id: string }>(type: GraphNodeType, list: readonly T[]) =>
      this.rows.set(type, new Map(list.map((row) => [row.id, row])));
    index("CLIENT", db.clients);
    index("CONTACT", db.contacts);
    index("PROJECT", db.projects);
    index("INVOICE", db.invoices);
    index("PAYMENT", db.payments);
    index("EXPENSE", db.expenses);
    index("ACCOUNT", db.accounts);
    index("DOCUMENT", db.documents);
    index("NOTE", db.notes);
    index("TECHNOLOGY", db.technologies);
    index("TAG", db.tags);
  }

  get db(): MockStore {
    return this.ctx.db;
  }

  row<T>(ref: Ref): T | undefined {
    return this.rows.get(ref.type)?.get(ref.id) as T | undefined;
  }

  readable(type: GraphNodeType): boolean {
    const resource = RESOURCE[type];
    return resource === null || can(this.ctx.user, "read", resource);
  }

  facts(ref: Ref): NodeFacts | null {
    const key = nodeIdOf(ref);
    if (!this.factsCache.has(key)) this.factsCache.set(key, nodeFacts(this, ref));
    return this.factsCache.get(key) ?? null;
  }

  relations(ref: Ref): Relation[] {
    const key = nodeIdOf(ref);
    let list = this.relationsCache.get(key);
    if (!list) {
      list = relationsOf(this.db, ref);
      this.relationsCache.set(key, list);
    }
    return list;
  }

  /** Whether `ref` is a node the caller may see as a neighbour. */
  visible(ref: Ref): boolean {
    if (!this.readable(ref.type)) return false;
    const facts = this.facts(ref);
    return facts !== null && (!facts.archived || this.showArchived);
  }

  /** Visible relations of `ref`, ordered by type, label and id. */
  neighbours(ref: Ref): Relation[] {
    return this.relations(ref)
      .filter((item) => this.visible(item.other))
      .sort((a, b) => {
        const byType = (TYPE_ORDER.get(a.other.type) ?? 0) - (TYPE_ORDER.get(b.other.type) ?? 0);
        if (byType !== 0) return byType;
        const byLabel = (this.facts(a.other)?.label ?? "").localeCompare(
          this.facts(b.other)?.label ?? "",
          "es",
        );
        return byLabel !== 0 ? byLabel : a.other.id.localeCompare(b.other.id);
      });
  }

  node(ref: Ref): GraphNode {
    const facts = this.facts(ref);
    if (!facts) throw new ServiceError("NOT_FOUND");
    const node: GraphNode = {
      id: nodeIdOf(ref),
      type: ref.type,
      entityId: ref.id,
      label: facts.label,
      meta: facts.meta,
      archived: facts.archived,
      degree: this.neighbours(ref).length,
    };
    if (facts.code !== undefined) node.code = facts.code;
    if (facts.status !== undefined) node.status = facts.status;
    return node;
  }
}

// ───────────────────────────── Node facts (§8.12.2) ─────────────────────────────

type Store = MockStore;
type Row<K extends keyof Store> = Store[K] extends (infer T)[] ? T : never;

function nodeFacts(view: GraphView, ref: Ref): NodeFacts | null {
  const { db } = view;
  switch (ref.type) {
    case "CLIENT": {
      const row = view.row<Row<"clients">>(ref);
      if (!row) return null;
      return {
        label: row.tradeName,
        code: row.code,
        status: row.status,
        meta: {
          kind: row.kind,
          country: row.country,
          receivableUsd: view.financials ? clientReceivableUsd(db, row.id) : null,
        },
        archived: row.archivedAt !== null,
        date: dayOf(row.createdAt),
        tagIds: row.tagIds,
      };
    }
    case "CONTACT": {
      const row = view.row<Row<"contacts">>(ref);
      if (!row) return null;
      return {
        label: row.fullName,
        meta: { position: row.position, email: row.email },
        archived: row.archivedAt !== null,
        date: dayOf(row.createdAt),
        tagIds: row.tagIds,
      };
    }
    case "PROJECT": {
      const row = view.row<Row<"projects">>(ref);
      if (!row) return null;
      const stack = row.technologyIds
        .slice(0, STACK_ICONS)
        .map((id) => {
          const tech = view.row<Row<"technologies">>({ type: "TECHNOLOGY", id });
          return tech ? (tech.iconSlug ?? tech.slug) : null;
        })
        .filter((slug): slug is string => slug !== null);
      return {
        label: row.name,
        code: row.code,
        status: row.status,
        meta: {
          stack: stack.join(","),
          startDate: row.startDate,
          targetEndDate: row.targetEndDate,
        },
        archived: row.archivedAt !== null,
        date: row.startDate ?? dayOf(row.createdAt),
        tagIds: row.tagIds,
      };
    }
    case "INVOICE": {
      const row = view.row<Row<"invoices">>(ref);
      if (!row) return null;
      return {
        label: row.invoiceNumber,
        code: row.code,
        status: row.status,
        meta: {
          currency: row.currency,
          total: row.totals.total,
          balance: row.totals.balance,
          dueDate: row.dueDate,
        },
        archived: row.archivedAt !== null,
        date: row.issueDate,
        tagIds: null,
      };
    }
    case "PAYMENT": {
      const row = view.row<Row<"payments">>(ref);
      if (!row) return null;
      return {
        label: row.code,
        code: row.code,
        status: row.status,
        meta: {
          currency: row.currency,
          amount: row.amount,
          date: row.date,
          method: row.method.name,
        },
        archived: false,
        date: row.date,
        tagIds: null,
      };
    }
    case "EXPENSE": {
      const row = view.row<Row<"expenses">>(ref);
      if (!row) return null;
      return {
        label: row.description,
        code: row.code,
        status: row.status,
        meta: { currency: row.currency, amount: row.amount, date: row.date },
        archived: false,
        date: row.date,
        tagIds: null,
      };
    }
    case "ACCOUNT": {
      const row = view.row<Row<"accounts">>(ref);
      if (!row) return null;
      return {
        label: row.name,
        meta: { currency: row.currency, accountType: row.type },
        archived: false,
        date: row.openingDate,
        tagIds: null,
      };
    }
    case "DOCUMENT": {
      const row = view.row<Row<"documents">>(ref);
      if (!row) return null;
      const type = db.documentTypes.find((item) => item.id === row.typeId);
      const version = db.documentVersions.find((item) => item.id === row.currentVersionId);
      return {
        label: row.title,
        code: row.code,
        status: row.status,
        meta: { documentType: type?.name ?? null, version: version?.versionNumber ?? null },
        archived: row.archivedAt !== null,
        date: row.effectiveDate ?? dayOf(row.createdAt),
        tagIds: row.tagIds,
      };
    }
    case "NOTE": {
      const row = view.row<Row<"notes">>(ref);
      if (!row) return null;
      const author = db.users.find((user) => user.id === row.authorId);
      const text = richTextToPlainText(row.content);
      return {
        label: row.title ?? (firstWords(text) || row.id),
        meta: { author: author?.name ?? null, excerpt: firstWords(text, 20) },
        archived: row.archivedAt !== null,
        date: dayOf(row.createdAt),
        tagIds: row.tagIds,
      };
    }
    case "TECHNOLOGY": {
      const row = view.row<Row<"technologies">>(ref);
      if (!row) return null;
      return {
        label: row.name,
        meta: { iconSlug: row.iconSlug, category: row.category, color: row.color },
        archived: false,
        date: null,
        tagIds: null,
      };
    }
    case "TAG": {
      const row = view.row<Row<"tags">>(ref);
      if (!row) return null;
      return {
        label: row.name,
        meta: { color: row.color },
        archived: false,
        date: null,
        tagIds: null,
      };
    }
  }
}

/** Open balance in USD of the client's issued, live invoices (the "saldo por cobrar" of the card). */
function clientReceivableUsd(db: MockStore, clientId: string): string {
  const balances = db.invoices
    .filter(
      (row) =>
        row.client.id === clientId &&
        !row.archivedAt &&
        !row.isDraft &&
        row.status !== "ANULADA" &&
        compareMoney(row.totals.balanceUsd, "0") > 0,
    )
    .map((row) => row.totals.balanceUsd);
  return sumMoney(balances);
}

// ───────────────────────────── Relations (§8.12.3) ─────────────────────────────

const out = (type: GraphNodeType, id: string, relation: string, label?: string | null): Relation =>
  label
    ? { other: { type, id }, relation, label, outgoing: true }
    : { other: { type, id }, relation, outgoing: true };
const into = (
  type: GraphNodeType,
  id: string,
  relation: string,
  label?: string | null,
): Relation =>
  label
    ? { other: { type, id }, relation, label, outgoing: false }
    : { other: { type, id }, relation, outgoing: false };

/** Documents attached to and notes written on `ref` (documents and notes point at the entity). */
function attachments(db: MockStore, ref: Ref): Relation[] {
  const list: Relation[] = [];
  if (ATTACHABLE_TYPES.has(ref.type) && ref.type !== "DOCUMENT") {
    for (const link of db.documentLinks) {
      if (link.entityType === ref.type && link.entityId === ref.id) {
        list.push(into("DOCUMENT", link.documentId, "adjunto_a"));
      }
    }
  }
  for (const note of db.notes) {
    if (note.links.some((link) => link.entityType === ref.type && link.entityId === ref.id)) {
      list.push(into("NOTE", note.id, "anotado_en"));
    }
  }
  return list;
}

const tagged = (tagIds: readonly string[]): Relation[] =>
  tagIds.map((tagId) => out("TAG", tagId, "etiquetado"));

/** Every stored relation of `ref`, unfiltered. Duplicated targets are collapsed. */
function relationsOf(db: MockStore, ref: Ref): Relation[] {
  const list: Relation[] = [];
  switch (ref.type) {
    case "CLIENT": {
      const row = db.clients.find((item) => item.id === ref.id);
      for (const contact of db.contacts) {
        if (contact.clientId === ref.id) list.push(out("CONTACT", contact.id, "contacto"));
      }
      for (const project of db.projects) {
        const member = project.clients.find((item) => item.clientId === ref.id);
        if (member) list.push(out("PROJECT", project.id, "participa", member.role));
      }
      for (const invoice of db.invoices) {
        if (invoice.client.id === ref.id) list.push(out("INVOICE", invoice.id, "facturado_a"));
      }
      for (const payment of db.payments) {
        if (payment.client.id === ref.id) list.push(out("PAYMENT", payment.id, "pago"));
      }
      list.push(...attachments(db, ref), ...tagged(row?.tagIds ?? []));
      break;
    }
    case "CONTACT": {
      const row = db.contacts.find((item) => item.id === ref.id);
      if (row) list.push(into("CLIENT", row.clientId, "contacto"));
      list.push(...attachments(db, ref), ...tagged(row?.tagIds ?? []));
      break;
    }
    case "PROJECT": {
      const row = db.projects.find((item) => item.id === ref.id);
      for (const member of row?.clients ?? []) {
        list.push(into("CLIENT", member.clientId, "participa", member.role));
      }
      for (const invoice of db.invoices) {
        if (invoice.lines.some((line) => line.project?.id === ref.id)) {
          list.push(out("INVOICE", invoice.id, "incluido_en"));
        }
      }
      for (const expense of db.expenses) {
        if (expense.project?.id === ref.id) list.push(into("EXPENSE", expense.id, "imputado_a"));
      }
      list.push(...attachments(db, ref));
      for (const technologyId of row?.technologyIds ?? []) {
        list.push(out("TECHNOLOGY", technologyId, "usa"));
      }
      list.push(...tagged(row?.tagIds ?? []));
      break;
    }
    case "INVOICE": {
      const row = db.invoices.find((item) => item.id === ref.id);
      if (row) {
        list.push(into("CLIENT", row.client.id, "facturado_a"));
        for (const line of row.lines) {
          if (line.project) list.push(into("PROJECT", line.project.id, "incluido_en"));
        }
      }
      for (const allocation of db.paymentAllocations) {
        if (allocation.invoice.id === ref.id) {
          list.push(
            into("PAYMENT", allocation.paymentId, "paga", allocation.amountInvoiceCurrency),
          );
        }
      }
      list.push(...attachments(db, ref));
      break;
    }
    case "PAYMENT": {
      const row = db.payments.find((item) => item.id === ref.id);
      if (row) list.push(into("CLIENT", row.client.id, "pago"));
      for (const allocation of db.paymentAllocations) {
        if (allocation.paymentId === ref.id) {
          list.push(
            out("INVOICE", allocation.invoice.id, "paga", allocation.amountInvoiceCurrency),
          );
        }
      }
      if (row) list.push(out("ACCOUNT", row.account.id, "acreditado_en"));
      list.push(...attachments(db, ref));
      break;
    }
    case "EXPENSE": {
      const row = db.expenses.find((item) => item.id === ref.id);
      if (row?.project) list.push(out("PROJECT", row.project.id, "imputado_a"));
      if (row?.account) list.push(out("ACCOUNT", row.account.id, "pagado_desde"));
      list.push(...attachments(db, ref));
      break;
    }
    case "ACCOUNT": {
      for (const payment of db.payments) {
        if (payment.account.id === ref.id) list.push(into("PAYMENT", payment.id, "acreditado_en"));
      }
      for (const expense of db.expenses) {
        if (expense.account?.id === ref.id) list.push(into("EXPENSE", expense.id, "pagado_desde"));
      }
      break;
    }
    case "DOCUMENT": {
      const row = db.documents.find((item) => item.id === ref.id);
      for (const link of db.documentLinks) {
        if (link.documentId === ref.id) list.push(out(link.entityType, link.entityId, "adjunto_a"));
      }
      list.push(...attachments(db, ref), ...tagged(row?.tagIds ?? []));
      break;
    }
    case "NOTE": {
      const row = db.notes.find((item) => item.id === ref.id);
      for (const link of row?.links ?? []) {
        list.push(out(link.entityType, link.entityId, "anotado_en"));
      }
      list.push(...tagged(row?.tagIds ?? []));
      break;
    }
    case "TECHNOLOGY": {
      for (const project of db.projects) {
        if (project.technologyIds.includes(ref.id)) list.push(into("PROJECT", project.id, "usa"));
      }
      break;
    }
    case "TAG": {
      const holders: [GraphNodeType, readonly { id: string; tagIds: readonly string[] }[]][] = [
        ["CLIENT", db.clients],
        ["CONTACT", db.contacts],
        ["PROJECT", db.projects],
        ["DOCUMENT", db.documents],
        ["NOTE", db.notes],
      ];
      for (const [type, rows] of holders) {
        for (const row of rows) {
          if (row.tagIds.includes(ref.id)) list.push(into(type, row.id, "etiquetado"));
        }
      }
      break;
    }
  }
  const seen = new Set<string>();
  return list.filter((item) => {
    const key = nodeIdOf(item.other);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ───────────────────────────── Response assembly ─────────────────────────────

function edgeOf(ref: Ref, item: Relation): GraphEdge {
  const self = nodeIdOf(ref);
  const other = nodeIdOf(item.other);
  const [source, target] = item.outgoing ? [self, other] : [other, self];
  const edge: GraphEdge = {
    id: `${source}|${item.relation}|${target}`,
    source,
    target,
    relation: item.relation,
  };
  if (item.label !== undefined) edge.label = item.label;
  return edge;
}

class ResponseBuilder {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly edges = new Map<string, GraphEdge>();
  private readonly truncated: GraphTruncated[] = [];

  constructor(private readonly view: GraphView) {}

  has(ref: Ref): boolean {
    return this.nodes.has(nodeIdOf(ref));
  }

  addNode(ref: Ref): void {
    if (!this.has(ref)) this.nodes.set(nodeIdOf(ref), this.view.node(ref));
  }

  addEdge(edge: GraphEdge): void {
    this.edges.set(edge.id, edge);
  }

  /** Adds one page of the neighbours of `ref` (filtered by `include`); returns the neighbours added. */
  addPage(ref: Ref, include: ReadonlySet<GraphNodeType>, offset: number): Ref[] {
    const all = this.view.neighbours(ref).filter((item) => include.has(item.other.type));
    const page = all.slice(offset, offset + GRAPH_EXPANSION_LIMIT);
    const added: Ref[] = [];
    for (const item of page) {
      if (!this.has(item.other)) added.push(item.other);
      this.addNode(item.other);
      this.addEdge(edgeOf(ref, item));
    }
    const remaining = all.length - offset - page.length;
    if (remaining > 0) {
      this.truncated.push({
        nodeId: nodeIdOf(ref),
        remaining,
        cursor: String(offset + page.length),
      });
    }
    return added;
  }

  build(): GraphResponse {
    return {
      nodes: [...this.nodes.values()],
      edges: [...this.edges.values()],
      truncated: this.truncated,
    };
  }
}

/** The root of a detail graph or of an expansion: readable type, existing row, archived only with the grant. */
function requireRoot(view: GraphView, ref: Ref): void {
  if (!view.readable(ref.type)) throw new ServiceError("FORBIDDEN");
  const facts = view.facts(ref);
  if (!facts || (facts.archived && !view.seesArchived)) throw new ServiceError("NOT_FOUND");
}

function parseCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  if (!/^\d{1,9}$/.test(cursor)) {
    throw new ServiceError("VALIDATION", {
      fieldErrors: { cursor: [VALIDATION_MESSAGES.invalidOption] },
    });
  }
  return Number(cursor);
}

// ───────────────────────────── Services ─────────────────────────────

export async function getEntityGraph(
  ctx: MockServiceContext,
  input: GetEntityGraphInput,
): Promise<GraphResponse> {
  const seesArchived = can(ctx.user, "restore", "trash");
  const view = new GraphView(ctx, Boolean(input.includeArchived) && seesArchived);
  const root: Ref = { type: input.type, id: input.id };
  requireRoot(view, root);
  const include = new Set(input.include ?? ENTITY_GRAPH_DEFAULT_TYPES);

  const builder = new ResponseBuilder(view);
  builder.addNode(root);
  let frontier: Ref[] = [root];
  for (let level = 0; level < (input.depth ?? 1); level += 1) {
    const next: Ref[] = [];
    for (const ref of frontier) next.push(...builder.addPage(ref, include, 0));
    frontier = next;
  }
  return builder.build();
}

export async function expandNode(
  ctx: MockServiceContext,
  input: ExpandNodeInput,
): Promise<GraphResponse> {
  const parsed = parseGraphNodeId(input.nodeId);
  if (!parsed) {
    throw new ServiceError("VALIDATION", {
      fieldErrors: { nodeId: [VALIDATION_MESSAGES.invalidId] },
    });
  }
  const offset = parseCursor(input.cursor);
  const seesArchived = can(ctx.user, "restore", "trash");
  const view = new GraphView(ctx, Boolean(input.includeArchived) && seesArchived);
  const root: Ref = { type: parsed.type, id: parsed.entityId };
  requireRoot(view, root);

  const builder = new ResponseBuilder(view);
  builder.addNode(root);
  builder.addPage(root, new Set(input.include ?? ENTITY_GRAPH_DEFAULT_TYPES), offset);
  return builder.build();
}

/** The clients a node belongs to (`null` when the type is not client-scoped: accounts, catalogs). */
function clientScope(view: GraphView, ref: Ref, depth = 0): Set<string> | null {
  switch (ref.type) {
    case "CLIENT":
      return new Set([ref.id]);
    case "CONTACT":
    case "PROJECT":
    case "INVOICE":
    case "PAYMENT":
      return new Set(
        view
          .relations(ref)
          .filter((item) => item.other.type === "CLIENT")
          .map((item) => item.other.id),
      );
    case "EXPENSE":
    case "DOCUMENT":
    case "NOTE": {
      const scope = new Set<string>();
      if (depth > 1) return scope;
      for (const item of view.relations(ref)) {
        if (item.other.type === "TAG" || item.other.type === "ACCOUNT") continue;
        if (ref.type === "DOCUMENT" && item.relation === "anotado_en") continue;
        for (const id of clientScope(view, item.other, depth + 1) ?? []) scope.add(id);
      }
      return scope;
    }
    case "ACCOUNT":
    case "TECHNOLOGY":
    case "TAG":
      return null;
  }
}

/** Whether a candidate node passes the global filters (a filter skips the types it does not apply to). */
function passesFilters(
  view: GraphView,
  ref: Ref,
  facts: NodeFacts,
  filters: GlobalGraphFilters,
): boolean {
  if (filters.onlyActive) {
    if (facts.archived) return false;
    if (ref.type === "CLIENT" && facts.status === "INACTIVO") return false;
    if (ref.type === "PROJECT" && FINISHED_PROJECT_STATUSES.has(facts.status ?? "")) return false;
  }
  if (
    filters.statuses?.length &&
    facts.status !== undefined &&
    !filters.statuses.includes(facts.status)
  ) {
    return false;
  }
  if (filters.tagIds?.length) {
    const wanted = filters.tagIds;
    if (ref.type === "TAG" && !wanted.includes(ref.id)) return false;
    if (facts.tagIds !== null && !facts.tagIds.some((id) => wanted.includes(id))) return false;
  }
  if (filters.technologyIds?.length) {
    const wanted = filters.technologyIds;
    if (ref.type === "TECHNOLOGY" && !wanted.includes(ref.id)) return false;
    if (ref.type === "PROJECT") {
      const row = view.row<Row<"projects">>(ref);
      if (!row?.technologyIds.some((id) => wanted.includes(id))) return false;
    }
  }
  if (filters.clientIds?.length) {
    const scope = clientScope(view, ref);
    if (scope !== null && !filters.clientIds.some((id) => scope.has(id))) return false;
  }
  if (facts.date !== null) {
    if (filters.dateFrom && facts.date < filters.dateFrom) return false;
    if (filters.dateTo && facts.date > filters.dateTo) return false;
  }
  return true;
}

function idsOf(db: MockStore, type: GraphNodeType): string[] {
  const lists: Record<GraphNodeType, readonly { id: string }[]> = {
    CLIENT: db.clients,
    CONTACT: db.contacts,
    PROJECT: db.projects,
    INVOICE: db.invoices,
    PAYMENT: db.payments,
    EXPENSE: db.expenses,
    ACCOUNT: db.accounts,
    DOCUMENT: db.documents,
    NOTE: db.notes,
    TECHNOLOGY: db.technologies,
    TAG: db.tags,
  };
  return lists[type].map((row) => row.id);
}

export async function getGlobalGraph(
  ctx: MockServiceContext,
  input: GetGlobalGraphInput,
): Promise<GraphResponse> {
  const { filters } = input;
  const seesArchived = can(ctx.user, "restore", "trash");
  const view = new GraphView(ctx, filters.includeArchived && !filters.onlyActive && seesArchived);

  const kept: Ref[] = [];
  for (const type of GRAPH_NODE_TYPE_VALUES) {
    if (!input.include.includes(type) || !view.readable(type)) continue;
    for (const id of idsOf(ctx.db, type)) {
      const ref: Ref = { type, id };
      const facts = view.facts(ref);
      if (!facts || !view.visible(ref)) continue;
      if (passesFilters(view, ref, facts, filters)) kept.push(ref);
    }
  }

  const builder = new ResponseBuilder(view);
  for (const ref of kept) builder.addNode(ref);
  for (const ref of kept) {
    for (const item of view.relations(ref)) {
      if (builder.has(item.other)) builder.addEdge(edgeOf(ref, item));
    }
  }
  return builder.build();
}
