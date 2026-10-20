"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { DateText } from "@/components/patterns/date-text";
import { MoneyText } from "@/components/patterns/money-text";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  columnConfigToPreference,
  createDataTableColumnHelper,
  useTableUrlState,
  type ColumnConfig,
  type DataTableColumnDef,
  type FacetConfig,
} from "@/components/ui/data-table";
import { searchClientsAction } from "@/features/clients/actions";
import { setPreferenceAction } from "@/features/preferences/actions";
import type { ListQuery } from "@/lib/validators/common";
import { INVOICE_STATUS_VALUES } from "@/lib/validators/enums";
import type { InvoiceListRow } from "@/lib/validators/invoices";
import { tableColumnsKey } from "@/lib/validators/preferences";
import { listInvoicesAction } from "../actions";
import { INVOICE_COLUMN_IDS } from "../columns";
import { invoiceFilterOf } from "./invoice-table-query";

type InvoicesTableProps = {
  /** First page, read on the server for the query in the URL. */
  initialRows: InvoiceListRow[];
  initialTotal: number;
  /** Saved column layout (`table:invoices:columns`). */
  initialColumns?: ColumnConfig[];
  /** Currency codes of the catalog, for the currency facet. */
  currencies: string[];
  permissions: { canCreate: boolean; canUpdate: boolean };
};

const helper = createDataTableColumnHelper<InvoiceListRow>();

/**
 * `/invoices/list` (PRD §8.5, DT-25): the invoices of the company with facets, search, header sort and
 * pagination kept in the URL. The first render shows the server rows for the URL query; later query changes
 * reload through `listInvoicesAction` (the kit's URL state is shallow, so the server does not re-render).
 * Amounts stay in the invoice currency, with the USD snapshot next to them (C16).
 */
export function InvoicesTable({
  initialRows,
  initialTotal,
  initialColumns,
  currencies,
  permissions,
}: InvoicesTableProps) {
  const t = useTranslations("invoices");
  const tEnums = useTranslations("enums");
  const tErrors = useTranslations("common.errors");
  const { query, setQuery } = useTableUrlState();
  const [rows, setRows] = useState(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);

  // The first render already shows the server page for this URL; later query changes read through the action.
  const queryKey = JSON.stringify(query);
  const firstQueryKey = useRef(queryKey);
  const load = useCallback(
    async (next: ListQuery) => {
      setLoading(true);
      const result = await listInvoicesAction(invoiceFilterOf(next));
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

  const columns = useMemo<DataTableColumnDef<InvoiceListRow>[]>(
    () =>
      [
        helper.accessor("invoiceNumber", {
          header: t("table.columns.invoiceNumber"),
          size: 140,
          meta: { label: t("table.columns.invoiceNumber"), sortable: true, pinned: true },
          cell: ({ row }) => (
            <Link
              className="font-medium underline-offset-4 hover:underline"
              href={`/invoices/${row.original.id}`}
            >
              {row.original.invoiceNumber}
            </Link>
          ),
        }),
        helper.accessor((row) => row.client.label, {
          id: "client",
          header: t("table.columns.client"),
          size: 200,
          meta: { label: t("table.columns.client"), sortable: false },
        }),
        helper.accessor("issueDate", {
          header: t("table.columns.issueDate"),
          size: 130,
          meta: { label: t("table.columns.issueDate"), sortable: true },
          cell: ({ row }) => <DateText value={row.original.issueDate} />,
        }),
        helper.accessor("dueDate", {
          header: t("table.columns.dueDate"),
          size: 130,
          meta: { label: t("table.columns.dueDate"), sortable: true },
          cell: ({ row }) => <DateText value={row.original.dueDate} />,
        }),
        helper.accessor("total", {
          header: t("table.columns.total"),
          size: 150,
          meta: { label: t("table.columns.total"), sortable: true, align: "end" },
          cell: ({ row }) => (
            <MoneyText amount={row.original.total} currency={row.original.currency} />
          ),
        }),
        helper.accessor("balance", {
          header: t("table.columns.balance"),
          size: 150,
          meta: { label: t("table.columns.balance"), sortable: true, align: "end" },
          cell: ({ row }) => (
            <MoneyText amount={row.original.balance} currency={row.original.currency} />
          ),
        }),
        helper.accessor("balanceUsd", {
          header: t("table.columns.balanceUsd"),
          size: 150,
          meta: { label: t("table.columns.balanceUsd"), sortable: true, align: "end" },
          cell: ({ row }) => <MoneyText amount={row.original.balanceUsd} currency="USD" />,
        }),
        helper.accessor("status", {
          header: t("table.columns.status"),
          size: 180,
          meta: { label: t("table.columns.status"), sortable: true },
          cell: ({ row }) => (
            <span className="inline-flex flex-wrap items-center gap-1">
              <StatusBadge enumName="InvoiceStatus" value={row.original.status} />
              {row.original.hasPartialPayment ? (
                <span className="text-xs text-muted-foreground">{t("table.partialPayment")}</span>
              ) : null}
            </span>
          ),
        }),
      ] as DataTableColumnDef<InvoiceListRow>[],
    [t],
  );

  const facets = useMemo<FacetConfig[]>(
    () => [
      {
        id: "status",
        label: t("table.facets.status"),
        kind: "options",
        options: INVOICE_STATUS_VALUES.map((value) => ({
          value,
          label: tEnums(`InvoiceStatus.${value}`),
        })),
      },
      {
        id: "clientId",
        label: t("table.facets.client"),
        kind: "async",
        loadOptions: async (search) => {
          const result = await searchClientsAction({ q: search });
          return result.ok ? result.data.map((ref) => ({ value: ref.id, label: ref.label })) : [];
        },
      },
      {
        id: "currency",
        label: t("table.facets.currency"),
        kind: "options",
        options: currencies.map((code) => ({ value: code, label: code })),
      },
      {
        id: "issued",
        label: t("table.facets.issued"),
        kind: "dateRange",
        fromKey: "dateFrom",
        toKey: "dateTo",
      },
    ],
    [t, tEnums, currencies],
  );

  return (
    <DataTable<InvoiceListRow>
      data={rows}
      columns={columns}
      getRowId={(row) => row.id}
      total={total}
      query={query}
      onQueryChange={setQuery}
      loading={loading}
      facets={facets}
      searchPlaceholder={t("table.search.placeholder")}
      showArchivedToggle={permissions.canUpdate}
      initialColumns={initialColumns}
      onColumnsChange={(config) => {
        const visible = config.filter((column) =>
          (INVOICE_COLUMN_IDS as readonly string[]).includes(column.id),
        );
        void setPreferenceAction({
          key: tableColumnsKey("invoices"),
          value: columnConfigToPreference(visible),
        });
      }}
      emptyState={{
        title: t("table.empty.title"),
        description: t("table.empty.description"),
        action: permissions.canCreate ? (
          <Button asChild>
            <Link href="/invoices/new">
              <Plus aria-hidden />
              {t("page.newAction")}
            </Link>
          </Button>
        ) : undefined,
      }}
    />
  );
}
