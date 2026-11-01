import type { GraphMeta, GraphNodeType } from '../../ports/graph-read.port';

/** PRD §8.12.5. */
export interface GraphNodeOutput {
  /** `${type}:${entityId}` */
  readonly id: string;
  readonly type: GraphNodeType;
  readonly entityId: string;
  readonly label: string;
  readonly code?: string;
  readonly status?: string;
  readonly meta: GraphMeta;
  readonly archived: boolean;
  /** Every visible relation of the node, of any type, whatever `include` loads. */
  readonly degree: number;
}

export interface GraphEdgeOutput {
  readonly id: string;
  /** Node id. */
  readonly source: string;
  /** Node id. */
  readonly target: string;
  readonly relation: string;
  readonly label?: string;
}

/** A node with more neighbours than one page; `cursor` loads the next page through `ExpandNode`. */
export interface GraphTruncatedOutput {
  readonly nodeId: string;
  readonly remaining: number;
  readonly cursor: string;
}

export interface GraphResponse {
  readonly nodes: GraphNodeOutput[];
  readonly edges: GraphEdgeOutput[];
  readonly truncated: GraphTruncatedOutput[];
}

export interface GraphConnectedOutput {
  readonly nodeId: string;
  readonly type: GraphNodeType;
  readonly label: string;
  readonly degree: number;
}

/** Statistics of the global graph (PRD §8.12.4). */
export interface GraphStatsOutput {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly mostConnected: GraphConnectedOutput[];
}

export interface GlobalGraphResponse extends GraphResponse {
  readonly stats: GraphStatsOutput;
}
