import type { RecordedCall, RouteTable } from "@/lib/api/testing";
import type { GlobalGraphResponseDto, GraphResponseDto } from "@/lib/api/types/graph";
import { graphNodeId, type GraphNodeType } from "@/lib/validators/graph";

// MOCK — test fixtures for the graph components. Fictional names and ids, no real data. They answer the HTTP test
// double (`mockApi`), so the real Server Actions and openapi-fetch client run in the component tests.

type Graph = GraphResponseDto;
type GraphNodeDto = Graph["nodes"][number];
type GraphEdgeDto = Graph["edges"][number];

function node(
  type: GraphNodeType,
  entityId: string,
  label: string,
  options: { code?: string; archived?: boolean } = {},
): GraphNodeDto {
  return {
    id: graphNodeId(type, entityId),
    type,
    entityId,
    label,
    code: options.code,
    meta: {},
    archived: options.archived ?? false,
    degree: 0,
  };
}

function edge(source: string, relation: string, target: string): GraphEdgeDto {
  return { id: `${source}>${relation}>${target}`, source, target, relation };
}

/** A response whose node degrees count the edges of this response (the test double has no full relation list). */
function graph(
  nodes: GraphNodeDto[],
  edges: GraphEdgeDto[],
  truncated: Graph["truncated"] = [],
): Graph {
  const degree = (id: string) => edges.filter((e) => e.source === id || e.target === id).length;
  return { nodes: nodes.map((n) => ({ ...n, degree: degree(n.id) })), edges, truncated };
}

const EMPTY_PAGE = graph([], []);

const KAIROS = graphNodeId("CLIENT", "cli_kairos");
const KAIROS_WEB = graphNodeId("PROJECT", "pry_kairos_web");
const KAIROS_APP = graphNodeId("PROJECT", "pry_kairos_app");
const KAIROS_OLD = graphNodeId("PROJECT", "pry_kairos_old");
const MOCHIMA = graphNodeId("CLIENT", "cli_hotel_mochima");

/** `GET /api/v1/graph/{type}/{id}` for the client Kairos Studio: 1 more page of contacts behind "+10 más". */
export const CLIENT_ROOT_GRAPH: Graph = graph(
  [
    node("CLIENT", "cli_kairos", "Kairos Studio", { code: "CLI-0001" }),
    node("CONTACT", "con_kairos_ana", "Ana Pérez"),
    node("PROJECT", "pry_kairos_web", "Sitio web Kairos Studio", { code: "PRY-0001" }),
    node("PROJECT", "pry_kairos_app", "App de reservas Kairos", { code: "PRY-0002" }),
    node("INVOICE", "inv_kairos_001", "Factura Kairos 001", { code: "FAC-0001" }),
    node("PAYMENT", "pay_kairos_001", "Pago Kairos 001", { code: "PAG-0001" }),
    node("DOCUMENT", "doc_client_contract", "Contrato marco"),
    node("NOTE", "not_kairos_kickoff", "Kickoff"),
  ],
  [
    edge(KAIROS, "contacto", graphNodeId("CONTACT", "con_kairos_ana")),
    edge(KAIROS_WEB, "participa", KAIROS),
    edge(KAIROS_APP, "participa", KAIROS),
    edge(graphNodeId("INVOICE", "inv_kairos_001"), "facturado_a", KAIROS),
    edge(KAIROS, "paga", graphNodeId("PAYMENT", "pay_kairos_001")),
    edge(graphNodeId("DOCUMENT", "doc_client_contract"), "adjunto_a", KAIROS),
    edge(graphNodeId("NOTE", "not_kairos_kickoff"), "anotado_en", KAIROS),
  ],
  [{ nodeId: KAIROS, remaining: 10, cursor: "cur_kairos_2" }],
);

/** The same root with archived nodes, answered when `includeArchived=true` (the archived switch). */
export const CLIENT_ROOT_WITH_ARCHIVED: Graph = graph(
  [
    ...CLIENT_ROOT_GRAPH.nodes,
    node("PROJECT", "pry_kairos_old", "Proyecto archivado Kairos", {
      code: "PRY-0003",
      archived: true,
    }),
  ],
  [...CLIENT_ROOT_GRAPH.edges, edge(KAIROS_OLD, "participa", KAIROS)],
  CLIENT_ROOT_GRAPH.truncated,
);

const WEB_PAGE = graph(
  [
    node("DOCUMENT", "doc_web_brief", "Brief del sitio web"),
    node("INVOICE", "inv_web_001", "Factura web 001", { code: "FAC-0002" }),
    node("EXPENSE", "exp_web_hosting", "Hosting del sitio", { code: "GTO-0001" }),
  ],
  [
    edge(graphNodeId("DOCUMENT", "doc_web_brief"), "adjunto_a", KAIROS_WEB),
    edge(graphNodeId("INVOICE", "inv_web_001"), "incluido_en", KAIROS_WEB),
    edge(graphNodeId("EXPENSE", "exp_web_hosting"), "imputado_a", KAIROS_WEB),
  ],
);

const APP_PAGE = graph(
  [node("CLIENT", "cli_hotel_mochima", "Hotel Mochima", { code: "CLI-0002" })],
  [edge(KAIROS_APP, "participa", MOCHIMA)],
);

/** Page two of Kairos Studio's neighbours: ten more contacts, answered for the `cur_kairos_2` cursor. */
const CONTACTS_PAGE = graph(
  Array.from({ length: 10 }, (_, index) => {
    const number = String(50 + index).padStart(3, "0");
    return node("CONTACT", `con_bulk_${number}`, `Contacto ${number}`);
  }),
  Array.from({ length: 10 }, (_, index) =>
    edge(
      KAIROS,
      "contacto",
      graphNodeId("CONTACT", `con_bulk_${String(50 + index).padStart(3, "0")}`),
    ),
  ),
);

/** One page of the neighbours of a node, as `GET /api/v1/graph/nodes/{nodeId}/neighbours` answers it. */
export function neighboursPage(nodeId: string, cursor?: string | null): Graph {
  if (nodeId === KAIROS && cursor === "cur_kairos_2") return CONTACTS_PAGE;
  if (nodeId === KAIROS_WEB) return WEB_PAGE;
  if (nodeId === KAIROS_APP) return APP_PAGE;
  return EMPTY_PAGE;
}

/** The node id of a `/api/v1/graph/nodes/{nodeId}/neighbours` request path (the id is URL-encoded). */
export function nodeIdOfNeighbourPath(path: string): string {
  return decodeURIComponent(path.split("/")[5] ?? "");
}

/** Routes of the entity graph: the root (archived nodes with the switch on) and the neighbours pages. */
export function entityGraphRoutes(): RouteTable {
  return {
    "GET /api/v1/graph/{type}/{id}": (call: RecordedCall) => ({
      status: 200,
      body:
        call.search.get("includeArchived") === "true"
          ? CLIENT_ROOT_WITH_ARCHIVED
          : CLIENT_ROOT_GRAPH,
    }),
    "GET /api/v1/graph/nodes/{nodeId}/neighbours": (call: RecordedCall) => ({
      status: 200,
      body: neighboursPage(nodeIdOfNeighbourPath(call.path), call.search.get("cursor")),
    }),
  };
}

/** `GET /api/v1/graph`: clients, projects and documents of the company, with archived documents when asked. */
export function globalGraph(includeArchived = false): GlobalGraphResponseDto {
  const archived = includeArchived
    ? [node("DOCUMENT", "doc_2023_archivado", "Contrato 2023 (archivado)", { archived: true })]
    : [];
  const base = graph(
    [
      node("CLIENT", "cli_kairos", "Kairos Studio", { code: "CLI-0001" }),
      node("CLIENT", "cli_hotel_mochima", "Hotel Mochima", { code: "CLI-0002" }),
      node("PROJECT", "pry_kairos_web", "Sitio web Kairos Studio", { code: "PRY-0001" }),
      node("PROJECT", "pry_kairos_app", "App de reservas Kairos", { code: "PRY-0002" }),
      node("DOCUMENT", "doc_client_contract", "Contrato marco"),
      node("DOCUMENT", "doc_web_brief", "Brief del sitio web"),
      ...archived,
    ],
    [
      edge(KAIROS_WEB, "participa", KAIROS),
      edge(KAIROS_APP, "participa", KAIROS),
      edge(KAIROS_APP, "participa", MOCHIMA),
      edge(graphNodeId("DOCUMENT", "doc_client_contract"), "adjunto_a", KAIROS),
      edge(graphNodeId("DOCUMENT", "doc_web_brief"), "adjunto_a", KAIROS_WEB),
    ],
  );
  const ranked = base.nodes
    .filter((item) => item.degree > 0)
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 3);
  return {
    ...base,
    stats: {
      nodeCount: base.nodes.length,
      edgeCount: base.edges.length,
      mostConnected: ranked.map((item) => ({
        degree: item.degree,
        label: item.label,
        nodeId: item.id,
        type: item.type,
      })),
    },
  };
}

/** The global graph with the default filters (no archived nodes). */
export const GLOBAL_GRAPH: GlobalGraphResponseDto = globalGraph(false);

/** Routes of the global graph: the archived switch (`includeArchived=true`) adds an archived document. */
export function globalGraphRoutes(): RouteTable {
  return {
    "GET /api/v1/graph": (call: RecordedCall) => ({
      status: 200,
      body: globalGraph(call.search.get("includeArchived") === "true"),
    }),
  };
}

/** Id of the archived document the global routes answer with `includeArchived=true`. */
export const GLOBAL_ARCHIVED_NODE = graphNodeId("DOCUMENT", "doc_2023_archivado");
