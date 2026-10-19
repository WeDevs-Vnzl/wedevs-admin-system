"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  parseGraphNodeId,
  type GraphNodeType,
  type GraphResponse,
  type GraphTruncated,
} from "@/lib/validators/graph";
import { expandNodeAction, getEntityGraphAction } from "../actions";
import {
  ENTITY_GRAPH_TYPES,
  HIDDEN_BY_DEFAULT,
  collapseNode,
  emptyFilters,
  mergeExpansion,
  modelFromResponse,
  nodeDetailHref,
  nodeGraphHref,
  typeCounts,
  visibleGraph,
  type GraphFilterState,
} from "../graph-model";
import type { LayoutAlgorithm } from "../layout/compute-layout";
import { useGraphLayout } from "../layout/use-graph-layout";
import { GraphCanvas } from "./graph-canvas";
import { GraphFilters, type FilterGroup } from "./graph-filters";
import { GraphLegend } from "./graph-legend";
import { GraphNodeList } from "./graph-node-list";
import { GraphSidePanel } from "./graph-side-panel";
import { GraphToolbar } from "./graph-toolbar";
import { useGraphExplorer } from "./use-graph-explorer";
import { useGraphLabels } from "./use-graph-labels";

type EntityGraphProps = {
  /** `getEntityGraph` of the root, depth 1, every type (`ENTITY_GRAPH_TYPES`). */
  initial: GraphResponse;
  rootId: string;
  /** Owner/Admin (trash grant): the "Mostrar archivados" switch. */
  canSeeArchived: boolean;
};

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every((item) => b.has(item));

/**
 * Detail graph `/<entidad>/[id]/graph` (PRD §8.12.4, HU-24): the root and its direct relations; "+", double click
 * or "Expandir" loads a node's neighbours (incremental layout, pinned nodes stay), "−" collapses them, "+N más"
 * pages past 50 neighbours. Filters work on the loaded nodes without a request (CA4); the archived switch reloads
 * the root with archived nodes.
 */
export function EntityGraph({ initial, rootId, canSeeArchived }: EntityGraphProps) {
  const t = useTranslations("graph");
  const router = useRouter();
  const labels = useGraphLabels();
  const root = parseGraphNodeId(rootId);
  const [model, setModel] = useState(() => modelFromResponse(initial, rootId));
  const [filters, setFilters] = useState<GraphFilterState>(() => emptyFilters(HIDDEN_BY_DEFAULT));
  const [includeArchived, setIncludeArchived] = useState(false);
  const [algorithm, setAlgorithm] = useState<LayoutAlgorithm>("radial");
  const [reloads, setReloads] = useState(0);
  const {
    containerRef,
    selectedId,
    setSelectedId,
    highlightedId,
    centerRequest,
    searchStatus,
    search,
    focus,
    setFocus,
    pinned,
    markPinned,
    unpin,
    fullscreen,
    toggleFullscreen,
    exportAs,
  } = useGraphExplorer({ labels, filename: `grafo-${root?.entityId ?? "entidad"}` });

  const visible = useMemo(
    () => visibleGraph(model, filters, focus ? selectedId : null),
    [model, filters, focus, selectedId],
  );

  // Every loaded node is laid out (hidden ones too), so filtering never moves the rest.
  const layoutInput = useMemo(() => {
    const truncated = [...model.truncated.values()];
    const anchors: Record<string, string> = {};
    for (const [id, owner] of model.addedBy) if (model.nodes.has(id)) anchors[id] = owner;
    for (const item of truncated) anchors[`more:${item.nodeId}`] = item.nodeId;
    return {
      nodes: [
        ...[...model.nodes.keys()].map((id) => ({ id })),
        ...truncated.map((item) => ({ id: `more:${item.nodeId}` })),
      ],
      edges: [
        ...[...model.edges.values()].map(({ source, target }) => ({ source, target })),
        ...truncated.map((item) => ({ source: item.nodeId, target: `more:${item.nodeId}` })),
      ],
      anchors,
    };
  }, [model]);
  const layout = useGraphLayout({
    algorithm,
    nodes: layoutInput.nodes,
    edges: layoutInput.edges,
    rootId,
    pinned,
    anchors: layoutInput.anchors,
    layoutKey: `${algorithm}:${reloads}`,
  });

  const expand = useCallback(
    async (nodeId: string, cursor?: string) => {
      const result = await expandNodeAction({
        nodeId,
        cursor,
        include: ENTITY_GRAPH_TYPES,
        includeArchived,
      });
      if (!result.ok) {
        toast.error(t("errors.expand"));
        return;
      }
      setModel((current) => mergeExpansion(current, nodeId, result.data).model);
    },
    [includeArchived, t],
  );
  const onExpand = useCallback((nodeId: string) => void expand(nodeId), [expand]);
  const onLoadMore = useCallback(
    (truncated: GraphTruncated) => void expand(truncated.nodeId, truncated.cursor),
    [expand],
  );
  const onCollapse = useCallback(
    (nodeId: string) => {
      setModel((current) => {
        const next = collapseNode(current, nodeId);
        if (selectedId && !next.nodes.has(selectedId)) setSelectedId(null);
        return next;
      });
    },
    [selectedId, setSelectedId],
  );

  async function toggleArchived(checked: boolean) {
    if (!root) return;
    const result = await getEntityGraphAction({
      type: root.type,
      id: root.entityId,
      include: ENTITY_GRAPH_TYPES,
      includeArchived: checked,
    });
    if (!result.ok) {
      toast.error(t("errors.load"));
      return;
    }
    setIncludeArchived(checked);
    setModel(modelFromResponse(result.data, rootId));
    setReloads((value) => value + 1);
  }

  const edgesList = useMemo(() => [...model.edges.values()], [model]);
  const hrefOf = useCallback(
    (node: Parameters<typeof nodeDetailHref>[0]) => nodeDetailHref(node, edgesList),
    [edgesList],
  );

  // ── Filters ──
  const allNodes = [...model.nodes.values()];
  const counts = typeCounts(allNodes);
  const presentTypes = ENTITY_GRAPH_TYPES.filter((type) => counts[type]);
  const statusOptions = [
    ...new Map(
      allNodes
        .filter((node) => node.status)
        .map((node) => [
          `${node.type}:${node.status}`,
          `${labels.typeLabel(node.type)} · ${labels.statusLabel(node.type, node.status)}`,
        ]),
    ),
  ]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const tagOptions = allNodes
    .filter((node) => node.type === "TAG")
    .map((node) => ({ value: node.entityId, label: node.label }));
  const toggleIn = (set: ReadonlySet<string>, value: string, checked: boolean) => {
    const next = new Set(set);
    if (checked) next.add(value);
    else next.delete(value);
    return next;
  };
  const groups: FilterGroup[] = [
    {
      id: "status",
      title: t("filters.status"),
      options: statusOptions,
      selected: filters.statuses,
      onToggle: (value, checked) =>
        setFilters((current) => ({
          ...current,
          statuses: toggleIn(current.statuses, value, checked),
        })),
    },
    {
      id: "tags",
      title: t("filters.tags"),
      options: tagOptions,
      selected: filters.tagIds,
      onToggle: (value, checked) =>
        setFilters((current) => ({ ...current, tagIds: toggleIn(current.tagIds, value, checked) })),
    },
  ];
  const activeCount =
    (sameSet(filters.hiddenTypes, new Set(HIDDEN_BY_DEFAULT)) ? 0 : 1) +
    filters.statuses.size +
    filters.tagIds.size +
    (filters.dateFrom ? 1 : 0) +
    (filters.dateTo ? 1 : 0) +
    (includeArchived ? 1 : 0);

  const selected = selectedId ? (model.nodes.get(selectedId) ?? null) : null;

  return (
    <div
      ref={containerRef}
      className="flex flex-col gap-3 bg-background data-[fullscreen=true]:h-screen data-[fullscreen=true]:p-4"
      data-fullscreen={fullscreen}
    >
      <GraphToolbar
        onSearch={(query) => search(query, visible.nodes)}
        searchStatus={searchStatus}
        algorithm={algorithm}
        onAlgorithmChange={setAlgorithm}
        focus={focus}
        onFocusChange={setFocus}
        onExport={(format) => void exportAs(format, { ...visible, positions: layout.positions })}
        fullscreen={fullscreen}
        onFullscreenChange={toggleFullscreen}
        filters={
          <GraphFilters
            types={presentTypes.map((type) => ({
              type,
              label: labels.typePlural(type),
              count: counts[type] ?? 0,
              checked: !filters.hiddenTypes.has(type),
            }))}
            onTypeToggle={(type: GraphNodeType, checked) =>
              setFilters((current) => {
                const hiddenTypes = new Set(current.hiddenTypes);
                if (checked) hiddenTypes.delete(type);
                else hiddenTypes.add(type);
                return { ...current, hiddenTypes };
              })
            }
            groups={groups}
            dateFrom={filters.dateFrom}
            dateTo={filters.dateTo}
            onDateChange={(range) => setFilters((current) => ({ ...current, ...range }))}
            switches={
              canSeeArchived
                ? [
                    {
                      id: "archived",
                      label: t("filters.archived"),
                      checked: includeArchived,
                      onChange: (checked) => void toggleArchived(checked),
                    },
                  ]
                : []
            }
            activeCount={activeCount}
            onClear={() => {
              setFilters(emptyFilters(HIDDEN_BY_DEFAULT));
              if (includeArchived) void toggleArchived(false);
            }}
          />
        }
      />

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div
          className="relative h-[640px] overflow-hidden rounded-xl border data-[fullscreen=true]:h-full"
          data-fullscreen={fullscreen}
        >
          <GraphCanvas
            visible={visible}
            positions={layout.positions}
            labels={labels}
            rootId={rootId}
            expanded={model.expanded}
            pinned={pinned}
            selectedId={selectedId}
            highlightedId={highlightedId}
            centerRequest={centerRequest}
            fitNonce={layout.fitNonce}
            canExpand
            hrefOf={hrefOf}
            onSelect={setSelectedId}
            onExpand={onExpand}
            onCollapse={onCollapse}
            onLoadMore={onLoadMore}
            onOpen={(href) => router.push(href)}
            onPin={(id, point) => {
              layout.pin(id, point);
              markPinned(id);
            }}
          />
          {layout.computing ? (
            <p
              role="status"
              className="absolute top-3 left-3 rounded-md bg-background/90 px-2 py-1 text-xs text-muted-foreground"
            >
              {t("toolbar.computing")}
            </p>
          ) : null}
        </div>

        <aside className="flex min-w-0 flex-col gap-4 overflow-y-auto">
          <GraphSidePanel
            node={selected}
            labels={labels}
            detailHref={selected ? hrefOf(selected) : null}
            graphHref={selected && selected.id !== rootId ? nodeGraphHref(selected) : null}
            graphLinkLabel="viewGraph"
            expanded={
              selected && selected.id !== rootId ? model.expanded.has(selected.id) : undefined
            }
            onExpand={() => selected && onExpand(selected.id)}
            onCollapse={() => selected && onCollapse(selected.id)}
            pinned={selected ? pinned.has(selected.id) : false}
            onUnpin={() => selected && unpin(selected.id)}
            onClose={() => setSelectedId(null)}
          />
          <GraphLegend types={presentTypes} labels={labels} />
          <GraphNodeList
            nodes={visible.nodes}
            truncated={visible.truncated}
            labels={labels}
            rootId={rootId}
            selectedId={selectedId}
            expanded={model.expanded}
            canExpand
            onSelect={setSelectedId}
            onExpand={onExpand}
            onCollapse={onCollapse}
            onLoadMore={onLoadMore}
          />
        </aside>
      </div>
    </div>
  );
}
