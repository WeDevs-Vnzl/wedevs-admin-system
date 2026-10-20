"use client";

import { Minus, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import type { GraphNode, GraphTruncated } from "@/lib/validators/graph";
import { NODE_COLORS } from "./graph-styles";
import type { GraphLabels } from "./use-graph-labels";

// Keyboard alternative to the canvas (frontend-patterns :373): every visible node as a button that selects it (and
// opens the side panel), with "Expandir"/"Contraer" and the "+N más" pages of the entity graph.

type GraphNodeListProps = {
  nodes: readonly GraphNode[];
  truncated: readonly GraphTruncated[];
  labels: GraphLabels;
  rootId: string | null;
  selectedId: string | null;
  expanded: ReadonlySet<string>;
  canExpand: boolean;
  onSelect: (id: string) => void;
  onExpand: (id: string) => void;
  onCollapse: (id: string) => void;
  onLoadMore: (truncated: GraphTruncated) => void;
};

export function GraphNodeList({
  nodes,
  truncated,
  labels,
  rootId,
  selectedId,
  expanded,
  canExpand,
  onSelect,
  onExpand,
  onCollapse,
  onLoadMore,
}: GraphNodeListProps) {
  const t = useTranslations("graph");
  const headingId = useId();
  const labelOf = new Map(nodes.map((node) => [node.id, node.label]));

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2 rounded-xl border p-4">
      <h2 id={headingId} className="text-sm font-semibold">
        {t("list.title")}
      </h2>
      <p className="text-xs text-muted-foreground">{t("list.description")}</p>
      {nodes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("list.empty")}</p>
      ) : (
        <ul
          aria-labelledby={headingId}
          className="flex max-h-80 flex-col gap-1 overflow-y-auto overscroll-contain"
        >
          {nodes.map((node) => (
            <li key={node.id} className="flex items-center gap-1">
              <button
                type="button"
                aria-pressed={node.id === selectedId}
                aria-label={t("list.select", { label: node.label })}
                onClick={() => onSelect(node.id)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-muted"
              >
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: NODE_COLORS[node.type] }}
                />
                <span className="truncate">{node.label}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {labels.typeLabel(node.type)}
                </span>
              </button>
              {canExpand && node.id !== rootId ? (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t(expanded.has(node.id) ? "node.collapse" : "node.expand", {
                    label: node.label,
                  })}
                  onClick={() => (expanded.has(node.id) ? onCollapse(node.id) : onExpand(node.id))}
                >
                  {expanded.has(node.id) ? <Minus aria-hidden /> : <Plus aria-hidden />}
                </Button>
              ) : null}
            </li>
          ))}
          {truncated.map((item) => (
            <li key={`more:${item.nodeId}`}>
              <button
                type="button"
                onClick={() => onLoadMore(item)}
                className="w-full rounded-md px-2 py-1 text-left text-sm text-primary hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
              >
                {t("list.loadMore", {
                  count: item.remaining,
                  label: labelOf.get(item.nodeId) ?? item.nodeId,
                })}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
