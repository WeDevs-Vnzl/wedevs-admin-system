"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { DateText } from "@/components/patterns/date-text";
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
import { searchClientsAction } from "@/features/clients/actions";
import { catalogLabel } from "@/features/catalogs/components/catalog-label";
import { PAYMENT_STATUS_VALUES } from "@/lib/validators/enums";
import type { ListQuery } from "@/lib/validators/common";
import type { PaymentListRow } from "@/lib/validators/payments";
import { listPaymentsAction } from "../actions";
import { paymentFilterOf } from "./payment-table-query";

/** Option sources of the account, method and currency facets, read on the server with the first page. */
export type PaymentFacetSources = {
  accounts: { id: string; name: string }[];
  methods: { id: string; name: string; nameEn: string | null }[];
  currencies: { code: string; name: string }[];
};

type PaymentsTableProps = {
  /** First page, read on the server for the query in the URL. */
  initialRows: PaymentListRow[];
  initialTotal: number;
  facetSources: PaymentFacetSources;
  canCreate: boolean;
};

const helper = createDataTableColumnHelper<PaymentListRow>();

/**
 * The `/payments/list` table (DT-25, HU-13): amounts in the payment currency and in USD, with what is applied to
 * invoices and what is still unallocated (the client's credit, HU-13 CA5). The first render shows the server rows
 * for the URL query; later query changes reload through `listPaymentsAction` (the kit's URL state is shallow).
 */
export function PaymentsTable({
  initialRows,
  initialTotal,
  facetSources,
  canCreate,
}: PaymentsTableProps) {
  const t = useTranslations("payments");
  const tEnums = useTranslations("enums");
  const tErrors = useTranslations("common.errors");
  const locale = useLocale();
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
      const result = await listPaymentsAction(paymentFilterOf(next));
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

  const columns = useMemo<DataTableColumnDef<PaymentListRow>[]>(
    () =>
      [
        helper.accessor("code", {
          header: t("table.columns.code"),
          size: 130,
          meta: { label: t("table.columns.code"), sortable: true, pinned: true },
          cell: ({ row }) => (
            <Link href={`/payments/${row.original.id}`} className="hover:underline">
              <EntityCodeChip code={row.original.code} />
            </Link>
          ),
        }),
        helper.accessor("date", {
          header: t("table.columns.date"),
          size: 130,
          meta: { label: t("table.columns.date"), sortable: true },
          cell: ({ row }) => <DateText value={row.original.date} />,
        }),
        helper.display({
          id: "client",
          header: t("table.columns.client"),
          size: 200,
          meta: { label: t("table.columns.client") },
          cell: ({ row }) => row.original.client.label,
        }),
        helper.display({
          id: "method",
          header: t("table.columns.method"),
          size: 160,
          meta: { label: t("table.columns.method") },
          cell: ({ row }) => catalogLabel(row.original.method, locale),
        }),
        helper.display({
          id: "account",
          header: t("table.columns.account"),
          size: 160,
          meta: { label: t("table.columns.account") },
          cell: ({ row }) => row.original.account.label,
        }),
        helper.accessor("amount", {
          header: t("table.columns.amount"),
          size: 150,
          meta: { label: t("table.columns.amount"), sortable: true, align: "end" },
          cell: ({ row }) => (
            <MoneyText amount={row.original.amount} currency={row.original.currency} />
          ),
        }),
        helper.accessor("amountUsd", {
          header: t("table.columns.amountUsd"),
          size: 140,
          meta: { label: t("table.columns.amountUsd"), sortable: true, align: "end" },
          cell: ({ row }) => <MoneyText amount={row.original.amountUsd} currency="USD" />,
        }),
        helper.accessor("allocated", {
          header: t("table.columns.allocated"),
          size: 150,
          meta: { label: t("table.columns.allocated"), sortable: true, align: "end" },
          cell: ({ row }) => (
            <MoneyText amount={row.original.allocated} currency={row.original.currency} />
          ),
        }),
        helper.accessor("unallocated", {
          header: t("table.columns.unallocated"),
          size: 150,
          meta: { label: t("table.columns.unallocated"), sortable: true, align: "end" },
          cell: ({ row }) => (
            <MoneyText amount={row.original.unallocated} currency={row.original.currency} />
          ),
        }),
        helper.accessor("status", {
          header: t("table.columns.status"),
          size: 190,
          meta: { label: t("table.columns.status"), sortable: true },
          cell: ({ row }) => <StatusBadge enumName="PaymentStatus" value={row.original.status} />,
        }),
      ] as DataTableColumnDef<PaymentListRow>[],
    [t, locale],
  );

  const facets = useMemo<FacetConfig[]>(
    () => [
      {
        id: "status",
        label: t("table.facets.status"),
        kind: "options",
        options: PAYMENT_STATUS_VALUES.map((value) => ({
          value,
          label: tEnums(`PaymentStatus.${value}`),
        })),
      },
      {
        id: "clientId",
        label: t("table.facets.client"),
        kind: "async",
        loadOptions: async (search) => {
          const result = await searchClientsAction({ q: search || undefined });
          return result.ok
            ? result.data.map((client) => ({ value: client.id, label: client.label }))
            : [];
        },
      },
      {
        id: "accountId",
        label: t("table.facets.account"),
        kind: "options",
        options: facetSources.accounts.map((account) => ({
          value: account.id,
          label: account.name,
        })),
      },
      {
        id: "methodId",
        label: t("table.facets.method"),
        kind: "options",
        options: facetSources.methods.map((method) => ({
          value: method.id,
          label: catalogLabel(method, locale),
        })),
      },
      {
        id: "currency",
        label: t("table.facets.currency"),
        kind: "options",
        options: facetSources.currencies.map((currency) => ({
          value: currency.code,
          label: `${currency.code} · ${currency.name}`,
        })),
      },
      {
        id: "date",
        label: t("table.facets.date"),
        kind: "dateRange",
        fromKey: "dateFrom",
        toKey: "dateTo",
      },
      {
        id: "hasUnallocated",
        label: t("table.facets.unallocated"),
        kind: "options",
        options: [{ value: "true", label: t("table.facets.unallocatedOnly") }],
      },
    ],
    [t, tEnums, locale, facetSources],
  );

  return (
    <DataTable<PaymentListRow>
      data={rows}
      columns={columns}
      getRowId={(row) => row.id}
      total={total}
      query={query}
      onQueryChange={setQuery}
      loading={loading}
      facets={facets}
      searchPlaceholder={t("table.searchPlaceholder")}
      emptyState={{
        title: t("table.empty.title"),
        description: t("table.empty.description"),
        action: canCreate ? (
          <Button asChild>
            <Link href="/payments/new">
              <Plus aria-hidden />
              {t("page.newAction")}
            </Link>
          </Button>
        ) : undefined,
      }}
    />
  );
}
