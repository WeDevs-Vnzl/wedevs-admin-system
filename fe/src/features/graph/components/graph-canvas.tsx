"use client";

import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Minus, Pin, Plus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { memo, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { cn } from "@/lib/utils";
import type { GraphNode, GraphTruncated } from "@/lib/validators/graph";
import type { VisibleGraph } from "../graph-model";
import { NODE_HEIGHT, NODE_WIDTH, type Point, type Positions } from "../layout/compute-layout";
import { MORE_COLOR, NODE_COLORS, NODE_ICONS } from "./graph-styles";
import type { GraphLabels } from "./use-graph-labels";

// The React Flow canvas (DT-12) of both graphs. Nodes are laid out by `useGraphLayout` (centers); edges are straight
// lines between node centers. Interactions of PRD §8.12.4 handled here: click selects, Ctrl/⌘ + click opens the
// detail, double click expands, "+"/"−" on the node, hover card after 300 ms, drag pins, "+N más" pages the rest.

export const HOVER_DELAY_MS = 300;
const EDGE_LABEL_LIMIT = 80;

export type Halo = { id: string; label: string; center: Point; radius: number };

export type GraphCanvasProps = {
  visible: VisibleGraph;
  positions: Positions;
  labels: GraphLabels;
  rootId: string | null;
  expanded: ReadonlySet<string>;
  pinned: ReadonlySet<string>;
  selectedId: string | null;
  highlightedId: string | null;
  /** Centers the view on a node; a new `nonce` re-centers on the same node. */
  centerRequest: { id: string; nonce: number } | null;
  fitNonce: number;
  halos?: Halo[];
  /** Entity graph: "+"/"−" and double click; the global graph has no expansion. */
  canExpand: boolean;
  hrefOf: (node: GraphNode) => string | null;
  onSelect: (id: string | null) => void;
  onExpand: (id: string) => void;
  onCollapse: (id: string) => void;
  onLoadMore: (truncated: GraphTruncated) => void;
  onOpen: (href: string) => void;
  onPin: (id: string, center: Point) => void;
};

type EntityNodeData = {
  node: GraphNode;
  labels: GraphLabels;
  isRoot: boolean;
  expanded: boolean;
  pinned: boolean;
  highlighted: boolean;
  canExpand: boolean;
  href: string | null;
  onExpand: (id: string) => void;
  onCollapse: (id: string) => void;
};
type MoreNodeData = {
  truncated: GraphTruncated;
  parentLabel: string;
  onLoadMore: (t: GraphTruncated) => void;
};
type HaloNodeData = { label: string };

const moreId = (nodeId: string) => `more:${nodeId}`;

// Invisible handles at the node center, so straight edges join node centers whatever the layout direction.
const CENTER_HANDLE = {
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: 1,
  height: 1,
  minWidth: 0,
  minHeight: 0,
  border: 0,
  opacity: 0,
  pointerEvents: "none",
} as const;

const EntityNodeView = memo(function EntityNodeView({
  data,
  selected,
}: NodeProps<Node<EntityNodeData>>) {
  const t = useTranslations("graph");
  const { node, labels } = data;
  const [hover, setHover] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const Icon = NODE_ICONS[node.type];
  const status = labels.statusLabel(node.type, node.status);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function enter() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setHover(true), HOVER_DELAY_MS);
  }
  function leave() {
    if (timer.current) clearTimeout(timer.current);
    setHover(false);
  }

  return (
    <div
      onMouseEnter={enter}
      onMouseLeave={leave}
      data-testid={`graph-node-${node.id}`}
      data-highlighted={data.highlighted || undefined}
      className={cn(
        "relative flex items-center gap-2 rounded-xl border bg-card px-2.5 text-left text-card-foreground shadow-sm",
        node.archived && "border-dashed opacity-70",
        selected && "ring-2 ring-ring",
        data.highlighted && "ring-4 ring-amber-400",
      )}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT, borderColor: NODE_COLORS[node.type] }}
    >
      <Handle type="target" position={Position.Top} style={CENTER_HANDLE} />
      <Handle type="source" position={Position.Bottom} style={CENTER_HANDLE} />
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-white"
        style={{ backgroundColor: NODE_COLORS[node.type] }}
        aria-hidden
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{node.label}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {[labels.typeLabel(node.type), node.code].filter(Boolean).join(" · ")}
        </span>
      </span>
      {data.pinned ? (
        <Pin className="size-3.5 shrink-0 text-muted-foreground" aria-label={t("node.pinned")} />
      ) : null}
      {data.canExpand && !data.isRoot ? (
        <button
          type="button"
          className="nodrag nopan absolute -top-2.5 -right-2.5 flex size-5 items-center justify-center rounded-full border bg-background text-foreground shadow-sm hover:bg-muted"
          aria-label={t(data.expanded ? "node.collapse" : "node.expand", { label: node.label })}
          onClick={(event) => {
            event.stopPropagation();
            if (data.expanded) data.onCollapse(node.id);
            else data.onExpand(node.id);
          }}
        >
          {data.expanded ? <Minus className="size-3" /> : <Plus className="size-3" />}
        </button>
      ) : null}
      {hover ? (
        <div
          role="dialog"
          aria-label={node.label}
          className="nodrag nopan absolute top-full left-0 z-50 mt-2 w-64 cursor-default rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg"
        >
          <p className="text-xs text-muted-foreground">
            {[labels.typeLabel(node.type), node.code].filter(Boolean).join(" · ")}
          </p>
          <p className="truncate font-medium">{node.label}</p>
          {status ? <p className="text-xs">{status}</p> : null}
          {node.archived ? (
            <p className="text-xs text-muted-foreground">{t("node.archived")}</p>
          ) : null}
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            {labels
              .metaLines(node)
              .slice(0, 5)
              .map((line) => (
                <div key={line.field} className="contents">
                  <dt className="text-muted-foreground">{line.label}</dt>
                  <dd className="truncate">{line.value}</dd>
                </div>
              ))}
          </dl>
          {data.href ? (
            <Link
              href={data.href}
              className="mt-2 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              {t("panel.openDetail")}
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

const MoreNodeView = memo(function MoreNodeView({ data }: NodeProps<Node<MoreNodeData>>) {
  const t = useTranslations("graph");
  return (
    <div
      className="flex items-center justify-center"
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
    >
      <Handle type="target" position={Position.Top} style={CENTER_HANDLE} />
      <button
        type="button"
        className="nodrag rounded-full border border-dashed bg-muted px-3 py-1.5 text-sm font-medium hover:bg-accent"
        aria-label={t("node.moreLabel", {
          count: data.truncated.remaining,
          label: data.parentLabel,
        })}
        onClick={(event) => {
          event.stopPropagation();
          data.onLoadMore(data.truncated);
        }}
      >
        {t("node.more", { count: data.truncated.remaining })}
      </button>
    </div>
  );
});

function HaloNodeView({ data, width, height }: NodeProps<Node<HaloNodeData>>) {
  return (
    <div
      aria-hidden
      className="rounded-full border border-primary/20 bg-primary/5"
      style={{ width, height }}
    >
      <span className="block pt-3 text-center text-xs font-medium text-muted-foreground">
        {data.label}
      </span>
    </div>
  );
}

const NO_HALOS: Halo[] = [];

const nodeTypes = { entity: EntityNodeView, more: MoreNodeView, halo: HaloNodeView };

const topLeft = (center: Point) => ({
  x: center.x - NODE_WIDTH / 2,
  y: center.y - NODE_HEIGHT / 2,
});

function CanvasInner(props: GraphCanvasProps) {
  const {
    visible,
    positions,
    labels,
    rootId,
    expanded,
    pinned,
    selectedId,
    highlightedId,
    centerRequest,
    fitNonce,
    halos = NO_HALOS,
    canExpand,
    hrefOf,
    onSelect,
    onExpand,
    onCollapse,
    onLoadMore,
    onOpen,
    onPin,
  } = props;
  const flow = useReactFlow();

  const built = useMemo<Node[]>(() => {
    const byId = new Map(visible.nodes.map((node) => [node.id, node]));
    const haloNodes: Node<HaloNodeData>[] = halos.map((halo) => ({
      id: `halo:${halo.id}`,
      type: "halo",
      position: { x: halo.center.x - halo.radius, y: halo.center.y - halo.radius },
      width: halo.radius * 2,
      height: halo.radius * 2,
      data: { label: halo.label },
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: -1,
    }));
    const entityNodes: Node<EntityNodeData>[] = visible.nodes.map((node) => ({
      id: node.id,
      type: "entity",
      position: topLeft(positions[node.id] ?? { x: 0, y: 0 }),
      selected: node.id === selectedId,
      hidden: !positions[node.id],
      data: {
        node,
        labels,
        isRoot: node.id === rootId,
        expanded: expanded.has(node.id),
        pinned: pinned.has(node.id),
        highlighted: node.id === highlightedId,
        canExpand,
        href: hrefOf(node),
        onExpand,
        onCollapse,
      },
    }));
    const moreNodes: Node<MoreNodeData>[] = visible.truncated.map((item) => ({
      id: moreId(item.nodeId),
      type: "more",
      position: topLeft(positions[moreId(item.nodeId)] ?? positions[item.nodeId] ?? { x: 0, y: 0 }),
      hidden: !positions[moreId(item.nodeId)],
      selectable: false,
      data: {
        truncated: item,
        parentLabel: byId.get(item.nodeId)?.label ?? item.nodeId,
        onLoadMore,
      },
    }));
    return [...haloNodes, ...entityNodes, ...moreNodes];
  }, [
    visible,
    positions,
    halos,
    labels,
    rootId,
    expanded,
    pinned,
    highlightedId,
    selectedId,
    canExpand,
    hrefOf,
    onExpand,
    onCollapse,
    onLoadMore,
  ]);

  // React Flow measures nodes into `measured`; keep it across rebuilds so edges never flicker. The rebuild is
  // merged while rendering (the "adjust state on prop change" pattern), not in an effect.
  const [nodes, setNodes] = useState<Node[]>(built);
  const [source, setSource] = useState(built);
  if (source !== built) {
    setSource(built);
    const measured = new Map(nodes.map((node) => [node.id, node.measured]));
    setNodes(built.map((node) => ({ ...node, measured: measured.get(node.id) ?? node.measured })));
  }

  const edges = useMemo<Edge[]>(() => {
    const withLabels = visible.edges.length <= EDGE_LABEL_LIMIT;
    return [
      ...visible.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "straight",
        label: withLabels ? labels.relationLabel(edge) : undefined,
        labelStyle: { fontSize: 10 },
      })),
      ...visible.truncated.map((item) => ({
        id: `edge:${moreId(item.nodeId)}`,
        source: item.nodeId,
        target: moreId(item.nodeId),
        type: "straight",
        style: { strokeDasharray: "4 4" },
      })),
    ];
  }, [visible, labels]);

  useEffect(() => {
    if (fitNonce > 0) void flow.fitView({ padding: 0.2, duration: 200 });
  }, [fitNonce, flow]);

  useEffect(() => {
    if (!centerRequest) return;
    const center = positions[centerRequest.id];
    if (center) void flow.setCenter(center.x, center.y, { zoom: 1.2, duration: 300 });
    // Re-center only on a new request, not when positions move afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerRequest, flow]);

  function onNodesChange(changes: NodeChange[]) {
    setNodes((current) => applyNodeChanges(changes, current));
  }

  function clicked(event: MouseEvent, node: Node) {
    if (node.type !== "entity") return;
    const data = node.data as EntityNodeData;
    if (event.ctrlKey || event.metaKey) {
      if (data.href) onOpen(data.href);
      return;
    }
    onSelect(node.id);
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeClick={clicked}
      onNodeDoubleClick={(_event, node) => {
        if (canExpand && node.type === "entity" && node.id !== rootId && !expanded.has(node.id)) {
          onExpand(node.id);
        }
      }}
      onNodeDragStop={(_event, node) => {
        if (node.type !== "entity") return;
        onPin(node.id, {
          x: node.position.x + NODE_WIDTH / 2,
          y: node.position.y + NODE_HEIGHT / 2,
        });
      }}
      onPaneClick={() => onSelect(null)}
      zoomOnDoubleClick={false}
      nodesConnectable={false}
      onlyRenderVisibleElements={visible.nodes.length > 200}
      minZoom={0.05}
      maxZoom={2.5}
    >
      <Background />
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        nodeColor={(node) =>
          node.type === "entity"
            ? NODE_COLORS[(node.data as EntityNodeData).node.type]
            : node.type === "more"
              ? MORE_COLOR
              : "transparent"
        }
      />
    </ReactFlow>
  );
}

export function GraphCanvas(props: GraphCanvasProps & { className?: string }) {
  const { className, ...rest } = props;
  return (
    <div className={cn("relative h-full min-h-[480px] w-full", className)}>
      <ReactFlowProvider>
        <CanvasInner {...rest} />
      </ReactFlowProvider>
    </div>
  );
}
