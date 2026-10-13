"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Archive, Plus, Tags } from "lucide-react";
import { toast } from "sonner";
import { DateText } from "@/components/patterns/date-text";
import { EntityCodeChip } from "@/components/patterns/entity-code-chip";
import { MoneyText } from "@/components/patterns/money-text";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { listCountries } from "@/components/ui/country-combobox/countries";
import {
  DataTable,
  columnConfigToPreference,
  createDataTableColumnHelper,
  useTableUrlState,
  type ColumnConfig,
  type DataTableColumnDef,
  type FacetConfig,
} from "@/components/ui/data-table";
import { useCsvExport } from "@/features/export/use-csv-export";
import { listTagsAction } from "@/features/tags/actions";
import { TagChips } from "@/features/tags/components/tag-chips";
import { setPreferenceAction } from "@/features/preferences/actions";
import { tableColumnsKey } from "@/lib/validators/preferences";
import { CLIENT_KIND_VALUES, CLIENT_STATUS_VALUES } from "@/lib/validators/enums";
import type { ListQuery } from "@/lib/validators/common";
import type { ClientListRowDTO } from "@/lib/validators/clients";
import { exportClientsCsvAction, listClientsAction } from "../actions";
import { CLIENT_COLUMN_IDS } from "../columns";
import { ClientArchiveDialog } from "./client-archive-dialog";
import { ClientBulkTagDialog } from "./client-bulk-tag-dialog";
import { clientFilterOf } from "./client-table-query";
import type { ClientScreenPermissions } from "./client-permissions";

type ClientsTableProps = {
  /** First page, read on the server for the query in the URL. */
  initialRows: ClientListRowDTO[];
  initialTotal: number;
  /** Saved column layout (`table:clients:columns`). */
  initialColumns: ColumnConfig[];
  permissions: Pick<
    ClientScreenPermissions,
    "canCreate" | "canUpdate" | "canArchive" | "canRestore" | "canSeeFinancials" | "canCreateTags"
  >;
};

type BulkDialog = "tag" | "archive" | null;

const helper = createDataTableColumnHelper<ClientListRowDTO>();
const OPTION_LIMIT = 50;

/**
 * The `/clients/list` table (PRD §7.3, §8.2). The first render shows the server rows for the URL query; later
 * query changes reload through `listClientsAction` (the kit's URL state is shallow, so the server does not
 * re-render). Financial columns exist only for roles that see money (C15).
 */
export function ClientsTable({
  initialRows,
  initialTotal,
  initialColumns,
  permissions,
}: ClientsTableProps) {
  const t = useTranslations("clients");
  const tEnums = useTranslations("enums");
  const tErrors = useTranslations("common.errors");
  const locale = useLocale();
  const { query, setQuery } = useTableUrlState();
  const [rows, setRows] = useState(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const [bulk, setBulk] = useState<{ kind: BulkDialog; ids: string[] }>({ kind: null, ids: [] });
  const exportCsv = useCsvExport(exportClientsCsvAction, "CLIENT");

  // The first render already shows the server page for this URL; later query changes read through the action.
  const queryKey = JSON.stringify(query);
  const firstQueryKey = useRef(queryKey);
  const load = useCallback(
    async (next: ListQuery) => {
      setLoading(true);
      const result = await listClientsAction(clientFilterOf(next));
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

  const columns = useMemo<DataTableColumnDef<ClientListRowDTO>[]>(() => {
    const base = [
      helper.accessor("code", {
        header: t("columns.code"),
        size: 120,
        meta: { label: t("columns.code"), sortable: true },
        cell: ({ row }) => <EntityCodeChip code={row.original.code} />,
      }),
      helper.accessor("tradeName", {
        header: t("columns.tradeName"),
        size: 220,
        meta: { label: t("columns.tradeName"), sortable: true, pinned: true },
        cell: ({ row }) => (
          <Link href={`/clients/${row.original.id}`} className="font-medium hover:underline">
            {row.original.tradeName}
          </Link>
        ),
      }),
      helper.accessor("kind", {
        header: t("columns.kind"),
        size: 120,
        meta: { label: t("columns.kind"), sortable: true },
        cell: ({ row }) => <StatusBadge enumName="ClientKind" value={row.original.kind} />,
      }),
      helper.accessor("country", {
        header: t("columns.country"),
        size: 100,
        meta: { label: t("columns.country"), sortable: true },
        cell: ({ row }) => <span className="tabular-nums">{row.original.country}</span>,
      }),
      helper.accessor("status", {
        header: t("columns.status"),
        size: 130,
        meta: { label: t("columns.status"), sortable: true },
        cell: ({ row }) => <StatusBadge enumName="ClientStatus" value={row.original.status} />,
      }),
      helper.accessor("projectCount", {
        header: t("columns.projectCount"),
        size: 130,
        meta: { label: t("columns.projectCount"), sortable: true, align: "end" },
        cell: ({ row }) => <span className="tabular-nums">{row.original.projectCount}</span>,
      }),
    ];
    const money = permissions.canSeeFinancials
      ? [
          helper.accessor("totalInvoicedUsd", {
            header: t("columns.totalInvoicedUsd"),
            size: 210,
            meta: { label: t("columns.totalInvoicedUsd"), sortable: true, align: "end" },
            cell: ({ row }) => <MoneyText amount={row.original.totalInvoicedUsd} currency="USD" />,
          }),
          helper.accessor("receivableUsd", {
            header: t("columns.receivableUsd"),
            size: 210,
            meta: { label: t("columns.receivableUsd"), sortable: true, align: "end" },
            cell: ({ row }) => <MoneyText amount={row.original.receivableUsd} currency="USD" />,
          }),
        ]
      : [];
    const tail = [
      helper.accessor("tags", {
        header: t("columns.tags"),
        size: 200,
        meta: { label: t("columns.tags"), sortable: false, wrap: true },
        cell: ({ row }) => <TagChips tags={row.original.tags} />,
      }),
      helper.accessor("lastActivityAt", {
        header: t("columns.lastActivityAt"),
        size: 160,
        meta: { label: t("columns.lastActivityAt"), sortable: true },
        cell: ({ row }) =>
          row.original.lastActivityAt ? (
            <DateText value={new Date(row.original.lastActivityAt)} />
          ) : (
            <span>{t("detail.keyData.none")}</span>
          ),
      }),
    ];
    return [...base, ...money, ...tail] as DataTableColumnDef<ClientListRowDTO>[];
  }, [t, permissions.canSeeFinancials]);

  const facets = useMemo<FacetConfig[]>(
    () => [
      {
        id: "status",
        label: t("facets.status"),
        kind: "options",
        options: CLIENT_STATUS_VALUES.map((value) => ({
          value,
          label: tEnums(`ClientStatus.${value}`),
        })),
      },
      {
        id: "kind",
        label: t("facets.kind"),
        kind: "options",
        options: CLIENT_KIND_VALUES.map((value) => ({
          value,
          label: tEnums(`ClientKind.${value}`),
        })),
      },
      {
        id: "country",
        label: t("facets.country"),
        kind: "async",
        loadOptions: async (search) => {
          const needle = search.trim().toLocaleLowerCase(locale);
          return listCountries(locale)
            .filter(
              (country) => needle === "" || country.name.toLocaleLowerCase(locale).includes(needle),
            )
            .slice(0, OPTION_LIMIT)
            .map((country) => ({ value: country.code, label: country.name }));
        },
      },
      {
        id: "tagId",
        label: t("facets.tag"),
        kind: "async",
        loadOptions: async (search) => {
          const result = await listTagsAction({ q: search || undefined, pageSize: OPTION_LIMIT });
          return result.ok
            ? result.data.items.map((tag) => ({ value: tag.id, label: tag.name }))
            : [];
        },
      },
      {
        id: "created",
        label: t("facets.created"),
        kind: "dateRange",
        fromKey: "createdFrom",
        toKey: "createdTo",
      },
    ],
    [t, tEnums, locale],
  );

  const openBulk = (kind: Exclude<BulkDialog, null>, ids: string[]) => setBulk({ kind, ids });
  const closeBulk = (open: boolean) => {
    if (!open) setBulk((current) => ({ ...current, kind: null }));
  };
  const reload = () => void load(query);

  return (
    <div className="flex flex-col gap-4">
      <DataTable<ClientListRowDTO>
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        total={total}
        query={query}
        onQueryChange={setQuery}
        loading={loading}
        facets={facets}
        searchPlaceholder={t("search.placeholder")}
        showArchivedToggle={permissions.canRestore}
        selectable={permissions.canUpdate || permissions.canArchive}
        bulkActions={(ids) => (
          <>
            {permissions.canUpdate ? (
              <Button variant="outline" size="sm" onClick={() => openBulk("tag", ids)}>
                <Tags aria-hidden />
                {t("bulk.tag")}
              </Button>
            ) : null}
            {permissions.canArchive ? (
              <Button variant="outline" size="sm" onClick={() => openBulk("archive", ids)}>
                <Archive aria-hidden />
                {t("bulk.archive")}
              </Button>
            ) : null}
          </>
        )}
        onExport={exportCsv}
        initialColumns={initialColumns}
        onColumnsChange={(config) => {
          const visible = config.filter((column) =>
            (CLIENT_COLUMN_IDS as readonly string[]).includes(column.id),
          );
          void setPreferenceAction({
            key: tableColumnsKey("clients"),
            value: columnConfigToPreference(visible),
          });
        }}
        emptyState={{
          title: t("empty.title"),
          description: t("empty.description"),
          action: permissions.canCreate ? (
            <Button asChild>
              <Link href="/clients/new">
                <Plus aria-hidden />
                {t("empty.action")}
              </Link>
            </Button>
          ) : undefined,
        }}
      />

      <ClientBulkTagDialog
        ids={bulk.ids}
        open={bulk.kind === "tag"}
        onOpenChange={closeBulk}
        canCreateTags={permissions.canCreateTags}
        onTagged={reload}
      />
      <ClientArchiveDialog
        ids={bulk.ids}
        open={bulk.kind === "archive"}
        onOpenChange={closeBulk}
        onArchived={reload}
      />
    </div>
  );
}
