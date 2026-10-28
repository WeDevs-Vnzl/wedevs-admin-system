"use client";

import { useTranslations } from "next-intl";
import type { GraphNode } from "@/lib/validators/graph";
import { NODE_COLORS } from "./graph-styles";

type GraphStatsProps = {
  nodeCount: number;
  edgeCount: number;
  mostConnected: { node: GraphNode; count: number }[];
  onSelect: (id: string) => void;
};

/** Global graph statistics (PRD §8.12.4): node and relation counts and the most connected nodes. */
export function GraphStats({ nodeCount, edgeCount, mostConnected, onSelect }: GraphStatsProps) {
  const t = useTranslations("graph.stats");
  return (
    <section aria-label={t("title")} className="flex flex-col gap-3 rounded-xl border p-4">
      <h2 className="text-sm font-semibold">{t("title")}</h2>
      <dl className="grid grid-cols-2 gap-2">
        <div>
          <dt className="text-xs text-muted-foreground">{t("nodes")}</dt>
          <dd className="text-lg font-semibold tabular-nums">{nodeCount}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("edges")}</dt>
          <dd className="text-lg font-semibold tabular-nums">{edgeCount}</dd>
        </div>
      </dl>
      {mostConnected.length ? (
        <div>
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">{t("mostConnected")}</h3>
          <ol className="flex flex-col gap-1">
            {mostConnected.map(({ node, count }) => (
              <li key={node.id}>
                <button
                  type="button"
                  onClick={() => onSelect(node.id)}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: NODE_COLORS[node.type] }}
                  />
                  <span className="truncate">{node.label}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                    {t("connections", { count })}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
