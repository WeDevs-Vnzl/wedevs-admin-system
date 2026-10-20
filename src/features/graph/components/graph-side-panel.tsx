"use client";

import { ExternalLink, Network, PinOff, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { GraphNode } from "@/lib/validators/graph";
import { NODE_COLORS } from "./graph-styles";
import type { GraphLabels } from "./use-graph-labels";

// Side panel of the selected node (PRD §8.12.4): its card data and "Abrir detalle", "Ver su grafo" (global graph:
// "Ver desde aquí"), "Expandir"/"Contraer" and "Desfijar" for a dragged node.

type GraphSidePanelProps = {
  node: GraphNode | null;
  labels: GraphLabels;
  detailHref: string | null;
  graphHref: string | null;
  graphLinkLabel: "viewGraph" | "viewFromHere";
  /** `undefined` hides the button (the root, the global graph). */
  expanded?: boolean;
  onExpand?: () => void;
  onCollapse?: () => void;
  pinned: boolean;
  onUnpin: () => void;
  onClose: () => void;
};

export function GraphSidePanel({
  node,
  labels,
  detailHref,
  graphHref,
  graphLinkLabel,
  expanded,
  onExpand,
  onCollapse,
  pinned,
  onUnpin,
  onClose,
}: GraphSidePanelProps) {
  const t = useTranslations("graph.panel");

  if (!node) {
    return (
      <section aria-label={t("title")} className="rounded-xl border p-4">
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      </section>
    );
  }
  const status = labels.statusLabel(node.type, node.status);

  return (
    <section aria-label={t("title")} className="flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              aria-hidden
              className="size-2.5 rounded-full"
              style={{ backgroundColor: NODE_COLORS[node.type] }}
            />
            {labels.typeLabel(node.type)}
          </p>
          <h2 className="truncate text-base font-semibold">{node.label}</h2>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label={t("close")} onClick={onClose}>
          <X aria-hidden />
        </Button>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        {node.code ? (
          <>
            <dt className="text-muted-foreground">{t("code")}</dt>
            <dd className="font-mono">{node.code}</dd>
          </>
        ) : null}
        {status ? (
          <>
            <dt className="text-muted-foreground">{t("status")}</dt>
            <dd>{status}</dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">{t("degree")}</dt>
        <dd className="tabular-nums">{node.degree}</dd>
        {labels.metaLines(node).map((line) => (
          <div key={line.field} className="contents">
            <dt className="text-muted-foreground">{line.label}</dt>
            <dd className="break-words">{line.value}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap gap-2">
        {detailHref ? (
          <Button size="sm" asChild>
            <Link href={detailHref}>
              <ExternalLink aria-hidden />
              {t("openDetail")}
            </Link>
          </Button>
        ) : null}
        {graphHref ? (
          <Button size="sm" variant="outline" asChild>
            <Link href={graphHref}>
              <Network aria-hidden />
              {t(graphLinkLabel)}
            </Link>
          </Button>
        ) : null}
        {expanded === undefined ? null : (
          <Button size="sm" variant="outline" onClick={expanded ? onCollapse : onExpand}>
            {expanded ? t("collapse") : t("expand")}
          </Button>
        )}
        {pinned ? (
          <Button size="sm" variant="ghost" onClick={onUnpin}>
            <PinOff aria-hidden />
            {t("unpin")}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
