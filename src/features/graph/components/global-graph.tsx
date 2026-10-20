"use client";

import { Group } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Toggle } from "@/components/ui/toggle";
import {
  GLOBAL_GRAPH_DEFAULT_TYPES,
  GRAPH_NODE_TYPE_VALUES,
  type GraphNode,
  type GraphNodeType,
  type GraphResponse,
} from "@/lib/validators/graph";
import { getGlobalGraphAction } from "../actions";
import {
  emptyFilters,
  modelFromResponse,
  mostConnected,
  nodeDetailHref,
  nodeGraphHref,
  typeCounts,
  visibleGraph,
} from "../graph-model";
import type { LayoutAlgorithm } from "../layout/compute-layout";
import { useGraphLayout } from "../layout/use-graph-layout";
import { GraphCanvas, type Halo } from "./graph-canvas";
import { GraphFilters, type FilterGroup } from "./graph-filters";
import { GraphLegend } from "./graph-legend";
import { GraphNodeList } from "./graph-node-list";
import { GraphSidePanel } from "./graph-side-panel";
import { GraphStats } from "./graph-stats";
import { GraphToolbar } from "./graph-toolbar";
import { useGraphExplorer } from "./use-graph-explorer";
import { useGraphLabels } from "./use-graph-labels";

type Option = { id: string; name: string };

type GlobalGraphProps = {
  /** `getGlobalGraph` with the defaults: clients, projects and documents (HU-25 CA1). */
  initial: GraphResponse;
  canSeeArchived: boolean;
  tags: Option[];
  technologies: Option[];
};

type ServerFilters = {
  include: GraphNodeType[];
  tagIds: string[];
  technologyIds: string[];
  clientIds: string[];
  dateFrom: string;
  dateTo: string;
  onlyActive: boolean;
  includeArchived: boolean;
};

const DEFAULT_SERVER_FILTERS: ServerFilters = {
  include: [...GLOBAL_GRAPH_DEFAULT_TYPES],
  tagIds: [],
  technologyIds: [],
  clientIds: [],
  dateFrom: "",
  dateTo: "",
  onlyActive: false,
  includeArchived: false,
};

const HALO_PADDING = 130;

const toggled = (list: readonly string[], value: string, checked: boolean) =>
  checked ? [...new Set([...list, value])] : list.filter((item) => item !== value);

/**
 * Global graph `/graph` (PRD §8.12.4, HU-25): clients, projects and documents with the force layout by default.
 * Types, tags, technologies, clients, dates, "Solo activos" and archived reload from the service; statuses (project
 * status included) filter the loaded nodes. "Agrupar por cliente" pulls each client's nodes together inside a halo.
 * Search centers and highlights a node; "Ver desde aquí" opens its detail graph.
 */
export function GlobalGraph({ initial, canSeeArchived, tags, technologies }: GlobalGraphProps) {
  const t = useTranslations("graph");
  const router = useRouter();
  const labels = useGraphLabels();
  const [data, setData] = useState(initial);
  const [server, setServer] = useState<ServerFilters>(DEFAULT_SERVER_FILTERS);
  const [statuses, setStatuses] = useState<ReadonlySet<string>>(new Set());
  const [algorithm, setAlgorithm] = useState<LayoutAlgorithm>("force");
  const [clusters, setClusters] = useState(false);
  const [clientOptions] = useState(() =>
    initial.nodes
      .filter((node) => node.type === "CLIENT")
      .map((node) => ({ value: node.entityId, label: node.label }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  );
  const {
    containerRef,
    selectedId,
    setSelectedId,
    highlightedId,
    centerRequest,
    centerOn,
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
  } = useGraphExplorer({ labels, filename: "grafo-global" });

  const serverKey = JSON.stringify(server);
  const firstLoad = useRef(true);
  const request = useRef(0);
  useEffect(() => {
    if (firstLoad.current) {
      firstLoad.current = false;
      return;
    }
    const id = (request.current += 1);
    void getGlobalGraphAction({
      include: server.include,
      filters: {
        tagIds: server.tagIds.length ? server.tagIds : undefined,
        technologyIds: server.technologyIds.length ? server.technologyIds : undefined,
        clientIds: server.clientIds.length ? server.clientIds : undefined,
        dateFrom: server.dateFrom || undefined,
        dateTo: server.dateTo || undefined,
        onlyActive: server.onlyActive,
        includeArchived: server.includeArchived,
      },
    }).then((result) => {
      if (id !== request.current) return;
      if (result.ok) setData(result.data);
      else toast.error(t("errors.load"));
    });
    // `serverKey` stands for `server`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey]);

  const model = useMemo(() => modelFromResponse(data, null), [data]);
  const visible = useMemo(
    () => visibleGraph(model, { ...emptyFilters(), statuses }, focus ? selectedId : null),
    [model, statuses, focus, selectedId],
  );

  // Cluster of each node: itself for a client, else its first client neighbour.
  const groupOf = useMemo(() => {
    const groups = new Map<string, string>();
    if (!clusters) return groups;
    for (const node of data.nodes) if (node.type === "CLIENT") groups.set(node.id, node.id);
    for (const edge of data.edges) {
      for (const [self, other] of [
        [edge.source, edge.target],
        [edge.target, edge.source],
      ] as const) {
        if (!groups.has(self) && other.startsWith("CLIENT:")) groups.set(self, other);
      }
    }
    return groups;
  }, [data, clusters]);

  const layoutNodes = useMemo(
    () => data.nodes.map((node) => ({ id: node.id, group: groupOf.get(node.id) })),
    [data, groupOf],
  );
  const layoutEdges = useMemo(
    () => data.edges.map(({ source, target }) => ({ source, target })),
    [data],
  );
  const layout = useGraphLayout({
    algorithm,
    nodes: layoutNodes,
    edges: layoutEdges,
    rootId: null,
    pinned,
    anchors: {},
    layoutKey: `${algorithm}:${serverKey}:${clusters}`,
  });

  const halos = useMemo<Halo[]>(() => {
    if (!clusters) return [];
    const members = new Map<string, { x: number; y: number }[]>();
    for (const node of visible.nodes) {
      const group = groupOf.get(node.id);
      const point = layout.positions[node.id];
      if (group && point) members.set(group, [...(members.get(group) ?? []), point]);
    }
    return [...members].flatMap(([group, points]) => {
      const client = model.nodes.get(group);
      if (!client || points.length < 2) return [];
      const center = {
        x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
        y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
      };
      const radius =
        Math.max(...points.map((point) => Math.hypot(point.x - center.x, point.y - center.y))) +
        HALO_PADDING;
      return [{ id: group, label: client.label, center, radius }];
    });
  }, [clusters, visible.nodes, groupOf, layout.positions, model]);

  const hrefOf = useCallback((node: GraphNode) => nodeDetailHref(node, data.edges), [data]);
  const noop = useCallback(() => {}, []);

  // ── Filters ──
  const counts = typeCounts(data.nodes);
  const loadedStatuses = [
    ...new Map(
      data.nodes
        .filter((node) => node.status)
        .map((node) => [`${node.type}:${node.status}`, node] as const),
    ).entries(),
  ];
  const statusOption = ([value, node]: (typeof loadedStatuses)[number], withType: boolean) => ({
    value,
    label: withType
      ? `${labels.typeLabel(node.type)} · ${labels.statusLabel(node.type, node.status)}`
      : (labels.statusLabel(node.type, node.status) ?? value),
  });
  const toggleStatus = (value: string, checked: boolean) =>
    setStatuses((current) => {
      const next = new Set(current);
      if (checked) next.add(value);
      else next.delete(value);
      return next;
    });
  const groups: FilterGroup[] = [
    {
      id: "projectStatus",
      title: t("filters.projectStatus"),
      options: loadedStatuses
        .filter(([value]) => value.startsWith("PROJECT:"))
        .map((item) => statusOption(item, false)),
      selected: statuses,
      onToggle: toggleStatus,
    },
    {
      id: "status",
      title: t("filters.status"),
      options: loadedStatuses
        .filter(([value]) => !value.startsWith("PROJECT:"))
        .map((item) => statusOption(item, true)),
      selected: statuses,
      onToggle: toggleStatus,
    },
    {
      id: "technologies",
      title: t("filters.technologies"),
      options: technologies.map((item) => ({ value: item.id, label: item.name })),
      selected: new Set(server.technologyIds),
      onToggle: (value, checked) =>
        setServer((current) => ({
          ...current,
          technologyIds: toggled(current.technologyIds, value, checked),
        })),
    },
    {
      id: "tags",
      title: t("filters.tags"),
      options: tags.map((item) => ({ value: item.id, label: item.name })),
      selected: new Set(server.tagIds),
      onToggle: (value, checked) =>
        setServer((current) => ({ ...current, tagIds: toggled(current.tagIds, value, checked) })),
    },
    {
      id: "clients",
      title: t("filters.clients"),
      options: clientOptions,
      selected: new Set(server.clientIds),
      onToggle: (value, checked) =>
        setServer((current) => ({
          ...current,
          clientIds: toggled(current.clientIds, value, checked),
        })),
    },
  ];
  const defaultTypes = new Set<string>(GLOBAL_GRAPH_DEFAULT_TYPES);
  const activeCount =
    (server.include.length === defaultTypes.size &&
    server.include.every((type) => defaultTypes.has(type))
      ? 0
      : 1) +
    statuses.size +
    server.tagIds.length +
    server.technologyIds.length +
    server.clientIds.length +
    (server.dateFrom ? 1 : 0) +
    (server.dateTo ? 1 : 0) +
    (server.onlyActive ? 1 : 0) +
    (server.includeArchived ? 1 : 0);

  const selected = selectedId ? (model.nodes.get(selectedId) ?? null) : null;
  const selectAndCenter = (id: string) => {
    setSelectedId(id);
    centerOn(id);
  };

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
        extra={
          <Toggle variant="outline" size="sm" pressed={clusters} onPressedChange={setClusters}>
            <Group aria-hidden />
            {t("toolbar.clusters")}
          </Toggle>
        }
        filters={
          <GraphFilters
            types={GRAPH_NODE_TYPE_VALUES.map((type) => ({
              type,
              label: labels.typePlural(type),
              count: counts[type] ?? 0,
              checked: server.include.includes(type),
            }))}
            onTypeToggle={(type, checked) =>
              setServer((current) => {
                const include = toggled(current.include, type, checked) as GraphNodeType[];
                return include.length ? { ...current, include } : current;
              })
            }
            groups={groups}
            dateFrom={server.dateFrom}
            dateTo={server.dateTo}
            onDateChange={(range) => setServer((current) => ({ ...current, ...range }))}
            switches={[
              {
                id: "onlyActive",
                label: t("filters.onlyActive"),
                checked: server.onlyActive,
                onChange: (checked) =>
                  setServer((current) => ({ ...current, onlyActive: checked })),
              },
              ...(canSeeArchived
                ? [
                    {
                      id: "archived",
                      label: t("filters.archived"),
                      checked: server.includeArchived,
                      onChange: (checked: boolean) =>
                        setServer((current) => ({ ...current, includeArchived: checked })),
                    },
                  ]
                : []),
            ]}
            activeCount={activeCount}
            onClear={() => {
              setServer(DEFAULT_SERVER_FILTERS);
              setStatuses(new Set());
            }}
          />
        }
      />

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div
          className="relative h-[680px] overflow-hidden rounded-xl border data-[fullscreen=true]:h-full"
          data-fullscreen={fullscreen}
        >
          <GraphCanvas
            visible={visible}
            positions={layout.positions}
            labels={labels}
            rootId={null}
            expanded={model.expanded}
            pinned={pinned}
            selectedId={selectedId}
            highlightedId={highlightedId}
            centerRequest={centerRequest}
            fitNonce={layout.fitNonce}
            halos={halos}
            canExpand={false}
            hrefOf={hrefOf}
            onSelect={setSelectedId}
            onExpand={noop}
            onCollapse={noop}
            onLoadMore={noop}
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
            graphHref={selected ? nodeGraphHref(selected) : null}
            graphLinkLabel="viewFromHere"
            pinned={selected ? pinned.has(selected.id) : false}
            onUnpin={() => selected && unpin(selected.id)}
            onClose={() => setSelectedId(null)}
          />
          <GraphStats
            nodeCount={visible.nodes.length}
            edgeCount={visible.edges.length}
            mostConnected={mostConnected(visible.nodes, visible.edges)}
            onSelect={selectAndCenter}
          />
          <GraphLegend
            types={GRAPH_NODE_TYPE_VALUES.filter((type) => counts[type])}
            labels={labels}
          />
          <GraphNodeList
            nodes={visible.nodes}
            truncated={visible.truncated}
            labels={labels}
            rootId={null}
            selectedId={selectedId}
            expanded={model.expanded}
            canExpand={false}
            onSelect={selectAndCenter}
            onExpand={noop}
            onCollapse={noop}
            onLoadMore={noop}
          />
        </aside>
      </div>
    </div>
  );
}
