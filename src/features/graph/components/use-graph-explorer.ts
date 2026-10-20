"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { GraphEdge, GraphNode } from "@/lib/validators/graph";
import { downloadPng, downloadSvg, graphToSvg } from "../graph-export";
import { searchNodes } from "../graph-model";
import type { Positions } from "../layout/compute-layout";
import type { GraphLabels } from "./use-graph-labels";

/**
 * View state shared by the entity and the global graph: selection, search (centers and highlights the best match,
 * HU-25 CA2), focus mode, pins, full screen and export. Data loading and layout stay in each graph, which passes
 * the visible nodes to `search` and `exportAs`.
 */
export function useGraphExplorer({ labels, filename }: { labels: GraphLabels; filename: string }) {
  const t = useTranslations("graph");
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [centerRequest, setCenterRequest] = useState<{ id: string; nonce: number } | null>(null);
  const [searchStatus, setSearchStatus] = useState("");
  const [focus, setFocus] = useState(false);
  const [pinned, setPinned] = useState<ReadonlySet<string>>(new Set());
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const centerOn = useCallback((id: string) => {
    setCenterRequest((current) => ({ id, nonce: (current?.nonce ?? 0) + 1 }));
  }, []);

  const search = useCallback(
    (query: string, nodes: readonly GraphNode[]) => {
      const [match] = searchNodes(nodes, query);
      if (!match) {
        setHighlightedId(null);
        setSearchStatus(query.trim() ? t("toolbar.noMatch", { query: query.trim() }) : "");
        return;
      }
      setSelectedId(match.id);
      setHighlightedId(match.id);
      centerOn(match.id);
      setSearchStatus(t("toolbar.centeredOn", { label: match.label }));
    },
    [centerOn, t],
  );

  const markPinned = useCallback((id: string) => {
    setPinned((current) => new Set(current).add(id));
  }, []);

  const unpin = useCallback((id: string) => {
    setPinned((current) => new Set([...current].filter((item) => item !== id)));
  }, []);

  const toggleFullscreen = useCallback(() => {
    const element = containerRef.current;
    if (!element) return;
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void element.requestFullscreen?.();
  }, []);

  const exportAs = useCallback(
    async (
      format: "png" | "svg",
      graph: { nodes: readonly GraphNode[]; edges: readonly GraphEdge[]; positions: Positions },
    ) => {
      const { nodes, edges, positions } = graph;
      try {
        const { svg, width, height } = graphToSvg({
          nodes,
          edges,
          positions,
          typeLabel: labels.typeLabel,
        });
        if (format === "svg") downloadSvg(svg, `${filename}.svg`);
        else await downloadPng(svg, width, height, `${filename}.png`);
      } catch {
        toast.error(t("errors.export"));
      }
    },
    [labels, filename, t],
  );

  return {
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
  };
}
