"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { EntityCodeChip } from "@/components/patterns/entity-code-chip";
import { MoneyText } from "@/components/patterns/money-text";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  createDataTableColumnHelper,
  useTableUrlState,
  type DataTableColumnDef,
  type FacetConfig,
} from "@/components/ui/data-table";
import { useCsvExport } from "@/features/export/use-csv-export";
import { searchClientsAction } from "@/features/clients/actions";
import { TagChips } from "@/features/tags/components/tag-chips";
import { exportProjectsCsvAction, listProjectsAction } from "@/features/projects/actions";
import { toProjectFilter } from "../table-filter";
import { technologyLabel } from "@/features/technologies/label";
import type { ResolvedIcon } from "@/features/technologies/components/tech-stack-icons";
import { formatDate } from "@/lib/dates";
import type { ListQuery } from "@/lib/validators/common";
import { PROJECT_STATUS_VALUES } from "@/lib/validators/enums";
import type { ProjectListRowDTO } from "@/lib/validators/projects";
import type { TechnologyChipDTO } from "@/lib/validators/technologies";
import type { TagChipDTO } from "@/lib/validators/tags";
import { ProjectsBulkActions } from "./projects-bulk-actions";

export interface ProjectsTableTechnology {
  id: string;
  label: string;
}

export interface ProjectsTableProps {
  /** First page, read on the server for the query in the URL. */
  initialRows: ProjectListRowDTO[];
  initialTotal: number;
  /** Stack facet: every catalogue technology, labelled for the locale (inactive ones too: they filter old rows). */
  technologies: readonly ProjectsTableTechnology[];
  /** Tag facet options. */
  tags: readonly TagChipDTO[];
  /** Brand icons by technology id, resolved on the server (the client never imports `simple-icons`). */
  icons: Record<string, ResolvedIcon | null>;
  showFinancials: boolean;
  canCreate: boolean;
  canArchive: boolean;
  canTag: boolean;
  /** Inline tag creation in the bulk tag picker (`canCreateTagsInline()`). */
  canCreateTags: boolean;
  /** `restore` on trash (Owner, Admin): shows "Mostrar archivados"; the service ignores it for anyone else (C19). */
  canRestore: boolean;
}

const helper = createDataTableColumnHelper<ProjectListRowDTO>();

/** The USD decimal-string columns of the row (C15: never converted or summed in the screen). */
type MoneyKey = "contractedValueUsd" | "invoicedUsd" | "collectedUsd" | "toInvoiceUsd";

/** The stack as icons: a brand glyph in its colour, or a colour dot; names in the tooltip (client-safe). */
function StackGlyphs({
  technologies,
  icons,
  locale,
}: {
  technologies: readonly TechnologyChipDTO[];
  icons: Record<string, ResolvedIcon | null>;
  locale: string;
}) {
  if (technologies.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {technologies.map((tech) => {
        const name = technologyLabel(tech, locale === "en" ? "en" : "es");
        const icon = icons[tech.id] ?? null;
        const color = tech.color ?? (icon ? `#${icon.hex}` : undefined);
        return (
          <span
            key={tech.id}
            role="img"
            aria-label={name}
            title={name}
            className="inline-flex size-6 items-center justify-center rounded-md"
          >
            {icon ? (
              <svg viewBox="0 0 24 24" className="size-4" fill={color} aria-hidden focusable="false">
                <path d={icon.path} />
              </svg>
            ) : (
              <span
                className="bg-muted-foreground size-2.5 rounded-full"
                style={color ? { backgroundColor: color } : undefined}
                aria-hidden
              />
            )}
          </span>
        );
      })}
    </span>
  );
}

/** The `/projects/list` table (PRD §8.3 "Tabla", HU-06 CA2): rows reload through the list action when the query changes. */
export function ProjectsTable({
  initialRows,
  initialTotal,
  technologies,
  tags,
  icons,
  showFinancials,
  canCreate,
  canArchive,
  canTag,
  canCreateTags,
  canRestore,
}: ProjectsTableProps) {
  const t = useTranslations("projects");
  const tList = useTranslations("projects.list");
  const tStatus = useTranslations("enums.ProjectStatus");
  const tErrors = useTranslations("common.errors");
  const locale = useLocale();
  const router = useRouter();
  const { query, setQuery } = useTableUrlState();
  const [rows, setRows] = useState(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const exportCsv = useCsvExport(exportProjectsCsvAction, "PROJECT");

  // The first render already shows the server page for this URL; later query changes read through the action.
  const queryKey = JSON.stringify(query);
  const firstQueryKey = useRef(queryKey);
  const load = useCallback(
    async (next: ListQuery) => {
      setLoading(true);
      const result = await listProjectsAction(toProjectFilter(next));
      setLoading(false);
      if (!result.ok) {
        toast.error(tErrors(result.error.code));
        return;
      }
      setRows(result.data.items);
      setTotal(result.data.total);
    },
    [tErrors],
  );

  useEffect(() => {
    if (queryKey === firstQueryKey.current) return;
    void load(query);
  }, [query, queryKey, load]);

  /** After a bulk change: the server page is refreshed and the rows reload for the current query. */
  const reload = useCallback(() => {
    router.refresh();
    void load(query);
  }, [load, query, router]);

  const facets = useMemo<FacetConfig[]>(
    () => [
      {
        id: "status",
        label: tList("filters.status"),
        kind: "options",
        options: PROJECT_STATUS_VALUES.map((value) => ({ value, label: tStatus(value) })),
      },
      {
        id: "clientId",
        label: tList("filters.client"),
        kind: "async",
        loadOptions: async (search) => {
          const result = await searchClientsAction({ q: search });
          if (!result.ok) return [];
          return result.data.map((ref) => ({ value: ref.id, label: ref.label }));
        },
      },
      {
        id: "technologyId",
        label: tList("filters.technology"),
        kind: "options",
        options: technologies.map((tech) => ({ value: tech.id, label: tech.label })),
      },
      {
        id: "tagId",
        label: tList("filters.tag"),
        kind: "options",
        options: tags.map((tag) => ({ value: tag.id, label: tag.name })),
      },
      { id: "delivery", label: tList("filters.delivery"), kind: "dateRange", fromKey: "deliveryFrom", toKey: "deliveryTo" },
      {
        id: "withoutBillingPlan",
        label: tList("filters.withoutBillingPlan"),
        kind: "options",
        options: [{ value: "true", label: tList("filters.withoutBillingPlanYes") }],
      },
    ],
    [tList, tStatus, technologies, tags],
  );

  const columns = useMemo<DataTableColumnDef<ProjectListRowDTO>[]>(() => {
    const money = (id: MoneyKey, label: string) =>
      helper.accessor(id, {
        header: label,
        size: 240,
        meta: { label, sortable: true, exportable: true, align: "end" },
        cell: ({ row }) => (
          <MoneyText amount={row.original[id]} currency="USD" />
        ),
      });

    const base: DataTableColumnDef<ProjectListRowDTO>[] = [
      helper.accessor("code", {
        header: t("columns.code"),
        size: 120,
        meta: { label: t("columns.code"), sortable: true, pinned: true },
        cell: ({ row }) => (
          <Link href={`/projects/${row.original.id}`} className="inline-flex">
            <EntityCodeChip code={row.original.code} />
          </Link>
        ),
      }),
      helper.accessor("name", {
        header: t("columns.name"),
        size: 220,
        meta: { label: t("columns.name"), sortable: true },
        cell: ({ row }) => (
          <Link href={`/projects/${row.original.id}`} className="font-medium hover:underline">
            {row.original.name}
          </Link>
        ),
      }),
      helper.display({
        id: "clients",
        header: t("columns.clients"),
        size: 220,
        meta: { label: t("columns.clients") },
        cell: ({ row }) =>
          row.original.clients
            .map(({ client, role }) => (role ? `${client.label} (${role})` : client.label))
            .join("; "),
      }),
      helper.accessor("status", {
        header: t("columns.status"),
        size: 130,
        meta: { label: t("columns.status"), sortable: true },
        cell: ({ row }) => <StatusBadge enumName="ProjectStatus" value={row.original.status} />,
      }),
      helper.accessor("startDate", {
        header: t("columns.startDate"),
        size: 130,
        meta: { label: t("columns.startDate"), sortable: true },
        cell: ({ row }) => (row.original.startDate ? formatDate(row.original.startDate, locale) : "—"),
      }),
      helper.accessor("targetEndDate", {
        header: t("columns.targetEndDate"),
        size: 190,
        meta: { label: t("columns.targetEndDate"), sortable: true },
        cell: ({ row }) => (row.original.targetEndDate ? formatDate(row.original.targetEndDate, locale) : "—"),
      }),
      helper.display({
        id: "stack",
        header: t("columns.stack"),
        size: 170,
        meta: { label: t("columns.stack"), wrap: true },
        cell: ({ row }) => (
          <StackGlyphs technologies={row.original.stack} icons={icons} locale={locale} />
        ),
      }),
    ];

    const financial = showFinancials
      ? [
          money("contractedValueUsd", t("columns.contractedValueUsd")),
          money("invoicedUsd", t("columns.invoicedUsd")),
          money("collectedUsd", t("columns.collectedUsd")),
          money("toInvoiceUsd", t("columns.toInvoiceUsd")),
        ]
      : [];

    const tail: DataTableColumnDef<ProjectListRowDTO>[] = [
      helper.display({
        id: "tags",
        header: t("columns.tags"),
        size: 200,
        meta: { label: t("columns.tags"), wrap: true },
        cell: ({ row }) => <TagChips tags={row.original.tags} />,
      }),
    ];
    return [...base, ...financial, ...tail];
  }, [t, locale, icons, showFinancials]);

  return (
    <DataTable<ProjectListRowDTO>
      data={rows}
      columns={columns}
      getRowId={(row) => row.id}
      total={total}
      query={query}
      onQueryChange={setQuery}
      loading={loading}
      facets={facets}
      searchPlaceholder={tList("search")}
      showArchivedToggle={canRestore}
      onExport={exportCsv}
      bulkActions={(ids) => (
        <ProjectsBulkActions
          ids={ids}
          canTag={canTag}
          canArchive={canArchive}
          canCreateTags={canCreateTags}
          onDone={reload}
        />
      )}
      emptyState={{
        title: tList("emptyTitle"),
        description: tList("emptyDescription"),
        action: canCreate ? (
          <Button asChild>
            <Link href="/projects/new">
              <PlusIcon aria-hidden />
              {tList("emptyCta")}
            </Link>
          </Button>
        ) : undefined,
      }}
    />
  );
}
