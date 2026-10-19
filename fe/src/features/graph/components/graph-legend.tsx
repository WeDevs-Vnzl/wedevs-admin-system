"use client";

import { Pin } from "lucide-react";
import { useTranslations } from "next-intl";
import type { GraphNodeType } from "@/lib/validators/graph";
import { MORE_COLOR, NODE_COLORS } from "./graph-styles";
import type { GraphLabels } from "./use-graph-labels";

/** Legend of the node colors on screen, plus the "+N más" and pinned markers. */
export function GraphLegend({
  types,
  labels,
}: {
  types: readonly GraphNodeType[];
  labels: GraphLabels;
}) {
  const t = useTranslations("graph.legend");
  return (
    <section aria-label={t("title")} className="rounded-xl border p-4">
      <h2 className="mb-2 text-sm font-semibold">{t("title")}</h2>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        {types.map((type) => (
          <li key={type} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-2.5 rounded-full"
              style={{ backgroundColor: NODE_COLORS[type] }}
            />
            {labels.typeLabel(type)}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-2.5 rounded-full border border-dashed"
            style={{ borderColor: MORE_COLOR }}
          />
          {t("more")}
        </li>
        <li className="flex items-center gap-1.5">
          <Pin aria-hidden className="size-3" />
          {t("pinned")}
        </li>
      </ul>
    </section>
  );
}
