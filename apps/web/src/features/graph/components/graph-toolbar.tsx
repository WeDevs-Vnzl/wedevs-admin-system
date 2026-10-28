"use client";

import { Crosshair, Download, Maximize, Minimize, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { LAYOUT_ALGORITHMS, type LayoutAlgorithm } from "../layout/compute-layout";

// Toolbar of both graphs: search inside the graph, layout switch, focus mode, filters (slot), export and full screen
// (PRD §8.12.4). Zoom, fit and the minimap live on the canvas itself.

type GraphToolbarProps = {
  onSearch: (query: string) => void;
  /** Result of the last search, announced to screen readers. */
  searchStatus: string;
  algorithm: LayoutAlgorithm;
  onAlgorithmChange: (algorithm: LayoutAlgorithm) => void;
  focus: boolean;
  onFocusChange: (focus: boolean) => void;
  filters: ReactNode;
  /** Extra toggles (the global graph's "Agrupar por cliente"). */
  extra?: ReactNode;
  onExport: (format: "png" | "svg") => void;
  fullscreen: boolean;
  onFullscreenChange: () => void;
};

export function GraphToolbar({
  onSearch,
  searchStatus,
  algorithm,
  onAlgorithmChange,
  focus,
  onFocusChange,
  filters,
  extra,
  onExport,
  fullscreen,
  onFullscreenChange,
}: GraphToolbarProps) {
  const t = useTranslations("graph.toolbar");
  const searchId = useId();
  const [query, setQuery] = useState("");

  return (
    <div role="toolbar" aria-label={t("label")} className="flex flex-wrap items-center gap-2">
      <form
        role="search"
        className="flex items-center gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch(query);
        }}
      >
        <label htmlFor={searchId} className="sr-only">
          {t("search")}
        </label>
        <Input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("searchPlaceholder")}
          className="h-8 w-56"
        />
        <Button type="submit" variant="outline" size="icon-sm" aria-label={t("searchSubmit")}>
          <Search aria-hidden />
        </Button>
      </form>
      <span role="status" aria-live="polite" className="sr-only">
        {searchStatus}
      </span>

      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={algorithm}
        onValueChange={(value) => {
          if (value) onAlgorithmChange(value as LayoutAlgorithm);
        }}
        aria-label={t("layout")}
      >
        {LAYOUT_ALGORITHMS.map((item) => (
          <ToggleGroupItem key={item} value={item}>
            {t(`layouts.${item}`)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <Toggle variant="outline" size="sm" pressed={focus} onPressedChange={onFocusChange}>
        <Crosshair aria-hidden />
        {t("focus")}
      </Toggle>
      {extra}
      {filters}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Download aria-hidden />
            {t("export")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onExport("png")}>{t("exportPng")}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onExport("svg")}>{t("exportSvg")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button variant="outline" size="sm" onClick={onFullscreenChange}>
        {fullscreen ? <Minimize aria-hidden /> : <Maximize aria-hidden />}
        {fullscreen ? t("exitFullscreen") : t("fullscreen")}
      </Button>
    </div>
  );
}
