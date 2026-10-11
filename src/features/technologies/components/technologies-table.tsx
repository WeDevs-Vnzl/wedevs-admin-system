"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useCsvExport } from "@/features/export/use-csv-export";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DataTable,
  createDataTableColumnHelper,
  useTableUrlState,
  type DataTableColumnDef,
} from "@/components/ui/data-table";
import { Switch } from "@/components/ui/switch";
import { isLocale, type Locale } from "@/i18n/config";
import { TECH_CATEGORY_VALUES } from "@/lib/validators/enums";
import type { TechnologyListRowDTO } from "@/lib/validators/technologies";
import { deleteTechnologyAction, exportTechnologiesCsvAction, setTechnologyActiveAction } from "../actions";
import { technologyLabel } from "../label";
import type { ResolvedIcon } from "./tech-stack-icons";
import { TechnologyFormDialog } from "./technology-form-dialog";

type TechnologiesTableProps = {
  rows: TechnologyListRowDTO[];
  total: number;
  /** Brand icons resolved on the server, by technology id (`null` when the slug has none). */
  icons: Record<string, ResolvedIcon | null>;
};

type FormTarget = { mode: "create" } | { mode: "edit"; technology: TechnologyListRowDTO } | null;

const helper = createDataTableColumnHelper<TechnologyListRowDTO>();

/** The brand glyph, or a colour dot. Plain props only: the icons arrive resolved from the server. */
function IconGlyph({ icon, color, name }: { icon: ResolvedIcon | null; color: string | null; name: string }) {
  const fill = color ?? (icon ? `#${icon.hex}` : undefined);
  if (icon) {
    return (
      <svg viewBox="0 0 24 24" className="size-4" fill={fill} role="img" aria-label={name}>
        <path d={icon.path} />
      </svg>
    );
  }
  return (
    <span
      role="img"
      aria-label={name}
      className="size-2.5 rounded-full bg-muted-foreground"
      style={fill ? { backgroundColor: fill } : undefined}
    />
  );
}

// Settings → Tecnologías (PRD §8.15): the catalog table, the create and edit dialog, activation, delete with the
// in-use lock (HU-06 CA3) and the CSV export of the filtered set.
export function TechnologiesTable({ rows, total, icons }: TechnologiesTableProps) {
  const t = useTranslations("catalogs.technologies");
  const tEnums = useTranslations("enums");
  const tErrors = useTranslations("common.errors");
  const router = useRouter();
  const localeValue = useLocale();
  const locale: Locale = isLocale(localeValue) ? localeValue : "es";
  const { query, setQuery } = useTableUrlState();
  const onExport = useCsvExport(exportTechnologiesCsvAction, "TECHNOLOGY");
  const [formTarget, setFormTarget] = useState<FormTarget>(null);
  const [deleteTarget, setDeleteTarget] = useState<TechnologyListRowDTO | null>(null);
  const [deleteMode, setDeleteMode] = useState<"delete" | "inUse">("delete");
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(() => router.refresh(), [router]);

  const setActive = useCallback(
    (technology: TechnologyListRowDTO, active: boolean) => {
      startTransition(async () => {
        const result = await setTechnologyActiveAction({ id: technology.id, active });
        if (!result.ok) {
          toast.error(tErrors(result.error.code));
          return;
        }
        toast.success(active ? t("toast.activated") : t("toast.deactivated"));
        refresh();
      });
    },
    [refresh, t, tErrors],
  );

  const confirmDelete = useCallback(() => {
    const technology = deleteTarget;
    if (!technology) return;
    startTransition(async () => {
      const result = await deleteTechnologyAction({ id: technology.id });
      if (!result.ok) {
        if (result.error.code === "INTEGRITY_LOCK") {
          setDeleteMode("inUse");
          return;
        }
        toast.error(tErrors(result.error.code));
        return;
      }
      setDeleteTarget(null);
      toast.success(t("toast.deleted"));
      refresh();
    });
  }, [deleteTarget, refresh, t, tErrors]);

  const openDelete = (technology: TechnologyListRowDTO) => {
    // A technology in use is locked from the start: the dialog offers deactivation, no request is sent.
    setDeleteMode(technology.usageCount > 0 ? "inUse" : "delete");
    setDeleteTarget(technology);
  };

  const columns = useMemo<DataTableColumnDef<TechnologyListRowDTO>[]>(
    () => [
      helper.display({
        id: "icon",
        header: t("table.columns.icon"),
        cell: ({ row }) => (
          <IconGlyph
            icon={icons[row.original.id] ?? null}
            color={row.original.color}
            name={technologyLabel(row.original, locale)}
          />
        ),
        size: 56,
        meta: { label: t("table.columns.icon"), hideable: false, exportable: false },
      }),
      helper.accessor("name", {
        header: t("table.columns.name"),
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="font-medium">{technologyLabel(row.original, locale)}</div>
            <div className="text-muted-foreground font-mono text-xs">{row.original.slug}</div>
          </div>
        ),
        meta: { label: t("table.columns.name"), sortable: true, pinned: true },
      }),
      helper.accessor("nameEn", {
        header: t("table.columns.nameEn"),
        cell: ({ getValue }) => getValue() ?? <span className="text-muted-foreground">—</span>,
        meta: { label: t("table.columns.nameEn") },
      }),
      helper.accessor("category", {
        header: t("table.columns.category"),
        cell: ({ getValue }) => tEnums(`TechCategory.${getValue()}`),
        meta: { label: t("table.columns.category"), sortable: true },
      }),
      helper.accessor("usageCount", {
        header: t("table.columns.usageCount"),
        cell: ({ getValue }) => t("table.usage", { count: getValue() }),
        meta: { label: t("table.columns.usageCount"), sortable: true },
      }),
      helper.accessor("active", {
        header: t("table.columns.active"),
        cell: ({ row }) => (
          <Switch
            checked={row.original.active}
            disabled={pending}
            onCheckedChange={(checked) => setActive(row.original, checked)}
            aria-label={
              row.original.active
                ? t("table.deactivate", { name: technologyLabel(row.original, locale) })
                : t("table.activate", { name: technologyLabel(row.original, locale) })
            }
          />
        ),
        meta: { label: t("table.columns.active"), sortable: true },
      }),
      helper.display({
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("table.edit", { name: technologyLabel(row.original, locale) })}
              onClick={() => setFormTarget({ mode: "edit", technology: row.original })}
            >
              <Pencil aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("table.delete", { name: technologyLabel(row.original, locale) })}
              onClick={() => openDelete(row.original)}
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        ),
        meta: { label: t("table.columns.actions"), hideable: false, exportable: false },
      }),
    ],
    [icons, locale, pending, setActive, t, tEnums],
  );

  const facets = useMemo(
    () => [
      {
        id: "category",
        kind: "options" as const,
        label: t("table.facets.category"),
        options: TECH_CATEGORY_VALUES.map((value) => ({ value, label: tEnums(`TechCategory.${value}`) })),
      },
      {
        id: "active",
        kind: "options" as const,
        label: t("table.facets.active"),
        options: [
          { value: "true", label: t("table.facets.activeOn") },
          { value: "false", label: t("table.facets.activeOff") },
        ],
      },
    ],
    [t, tEnums],
  );

  const deleteName = deleteTarget ? technologyLabel(deleteTarget, locale) : "";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button onClick={() => setFormTarget({ mode: "create" })}>
          <Plus data-icon="inline-start" aria-hidden />
          {t("table.new")}
        </Button>
      </div>

      <DataTable
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        total={total}
        query={query}
        onQueryChange={setQuery}
        facets={facets}
        searchPlaceholder={t("table.search")}
        selectable={false}
        onExport={onExport}
        emptyState={{
          title: t("table.empty.title"),
          description: t("table.empty.description"),
          action: (
            <Button onClick={() => setFormTarget({ mode: "create" })}>{t("table.new")}</Button>
          ),
        }}
      />

      <TechnologyFormDialog
        target={formTarget}
        onOpenChange={(open) => {
          if (!open) setFormTarget(null);
        }}
        onSaved={() => {
          setFormTarget(null);
          refresh();
        }}
      />

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteMode === "inUse" ? t("delete.inUseTitle") : t("delete.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteMode === "inUse"
                ? t("delete.inUseDescription", { name: deleteName })
                : t("delete.description", { name: deleteName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("delete.cancel")}</AlertDialogCancel>
            {deleteMode === "inUse" ? (
              <AlertDialogAction
                disabled={pending}
                onClick={(event) => {
                  event.preventDefault();
                  if (!deleteTarget) return;
                  setActive(deleteTarget, false);
                  setDeleteTarget(null);
                }}
              >
                {t("delete.deactivate")}
              </AlertDialogAction>
            ) : (
              <AlertDialogAction
                variant="destructive"
                disabled={pending}
                onClick={(event) => {
                  event.preventDefault();
                  confirmDelete();
                }}
              >
                {t("delete.action")}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
