"use client";

import { ArrowLeft, Ellipsis } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EntityCodeChip } from "./entity-code-chip";

type DetailHeaderProps = {
  backHref: string;
  // Avatar or entity icon.
  icon?: ReactNode;
  code: string;
  name: string;
  status?: ReactNode;
  tags?: ReactNode;
  meta?: ReactNode;
  // Always-visible "Detalle | Grafo" toggle (frontend-patterns §4).
  mode: "detail" | "graph";
  detailHref: string;
  graphHref: string;
  // Buttons such as "Compartir documentos" and "Editar".
  actions?: ReactNode;
  // Items of the "More" menu (Archive / Void / Restore), as DropdownMenuItem children.
  moreActions?: ReactNode;
};

export function DetailHeader({
  backHref,
  icon,
  code,
  name,
  status,
  tags,
  meta,
  mode,
  detailHref,
  graphHref,
  actions,
  moreActions,
}: DetailHeaderProps) {
  const t = useTranslations("patterns.detailHeader");

  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href={backHref}>
            <ArrowLeft />
            {t("back")}
          </Link>
        </Button>
        <ToggleGroup type="single" variant="outline" value={mode} aria-label={t("toggleLabel")}>
          <ToggleGroupItem value="detail" asChild>
            <Link href={detailHref} aria-current={mode === "detail" ? "page" : undefined}>
              {t("detail")}
            </Link>
          </ToggleGroupItem>
          <ToggleGroupItem value="graph" asChild>
            <Link href={graphHref} aria-current={mode === "graph" ? "page" : undefined}>
              {t("graph")}
            </Link>
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          {icon ? (
            <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-muted">
              {icon}
            </div>
          ) : null}
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <EntityCodeChip code={code} />
              {status}
            </div>
            <h1 className="truncate text-2xl font-semibold tracking-tight">{name}</h1>
            {tags ? <div className="flex flex-wrap gap-1">{tags}</div> : null}
            {meta ? <div className="text-sm text-muted-foreground">{meta}</div> : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {moreActions ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label={t("more")}>
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">{moreActions}</DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>
    </header>
  );
}
