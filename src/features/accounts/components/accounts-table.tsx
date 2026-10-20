"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  DataTable,
  createDataTableColumnHelper,
  useTableUrlState,
  type DataTableColumnDef,
  type FacetConfig,
} from "@/components/ui/data-table";
import { MoneyText } from "@/components/patterns/money-text";
import { ACCOUNT_STATUS_FILTER_VALUES, type AccountDTO } from "@/lib/validators/accounts";
import type { ListQuery } from "@/lib/validators/common";
import { ACCOUNT_TYPE_VALUES } from "@/lib/validators/enums";
import { listAccountsAction } from "../actions";
import { accountFilterOf } from "./account-table-query";

type AccountsTableProps = {
  /** First page, read on the server for the query in the URL. */
  initialRows: AccountDTO[];
  initialTotal: number;
  /** Currency codes offered by the currency facet (the currencies catalog). */
  currencies: string[];
};

const helper = createDataTableColumnHelper<AccountDTO>();

/**
 * `/accounts/list` (DT-25, S15): every account with its balance in its own currency and in USD, with the type,
 * currency and status facets, search, header sort and pagination in the URL. The first render shows the server
 * rows for the URL query; later query changes reload through `listAccountsAction`.
 */
export function AccountsTable({ initialRows, initialTotal, currencies }: AccountsTableProps) {
  const t = useTranslations("accounts");
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
      const result = await listAccountsAction(accountFilterOf(next));
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

  const columns = useMemo<DataTableColumnDef<AccountDTO>[]>(
    () => [
      helper.accessor("name", {
        header: t("table.columns.name"),
        cell: ({ row }) => (
          <Link
            className="font-medium underline-offset-4 hover:underline"
            href={`/accounts/${row.original.id}`}
          >
            {row.original.name}
          </Link>
        ),
        meta: { label: t("table.columns.name"), pinned: true, sortable: true },
        size: 220,
      }),
      helper.accessor("type", {
        header: t("table.columns.type"),
        cell: ({ getValue }) => tEnums(`AccountType.${getValue()}`),
        meta: { label: t("table.columns.type"), sortable: true },
        size: 180,
      }),
      helper.accessor("institution", {
        header: t("table.columns.institution"),
        cell: ({ getValue }) => getValue() ?? "—",
        meta: { label: t("table.columns.institution"), sortable: true },
        size: 160,
      }),
      helper.accessor("currency", {
        header: t("table.columns.currency"),
        meta: { label: t("table.columns.currency"), sortable: true },
        size: 110,
      }),
      helper.display({
        id: "balance",
        header: t("table.columns.balance"),
        cell: ({ row }) => (
          <MoneyText amount={row.original.balance} currency={row.original.currency} />
        ),
        meta: { label: t("table.columns.balance"), align: "end", sortable: true },
        size: 160,
      }),
      helper.display({
        id: "balanceUsd",
        header: t("table.columns.balanceUsd"),
        cell: ({ row }) =>
          row.original.balanceUsd === null ? (
            "—"
          ) : (
            <MoneyText amount={row.original.balanceUsd} currency="USD" />
          ),
        meta: { label: t("table.columns.balanceUsd"), align: "end", sortable: true },
        size: 160,
      }),
      helper.display({
        id: "status",
        header: t("table.columns.status"),
        cell: ({ row }) => (
          <Badge variant={row.original.active ? "secondary" : "outline"}>
            {row.original.active ? t("status.active") : t("status.inactive")}
          </Badge>
        ),
        meta: { label: t("table.columns.status"), sortable: true },
        size: 120,
      }),
    ],
    [t, tEnums],
  );

  const facets = useMemo<FacetConfig[]>(
    () => [
      {
        id: "type",
        label: t("table.facets.type"),
        kind: "options",
        options: ACCOUNT_TYPE_VALUES.map((value) => ({
          value,
          label: tEnums(`AccountType.${value}`),
        })),
      },
      {
        id: "currency",
        label: t("table.facets.currency"),
        kind: "options",
        options: currencies.map((code) => ({ value: code, label: code })),
      },
      {
        id: "status",
        label: t("table.facets.status"),
        kind: "options",
        options: ACCOUNT_STATUS_FILTER_VALUES.map((value) => ({
          value,
          label: t(`status.${value}`),
        })),
      },
    ],
    [t, tEnums, currencies],
  );

  return (
    <DataTable<AccountDTO>
      data={rows}
      columns={columns}
      getRowId={(row) => row.id}
      total={total}
      query={query}
      onQueryChange={setQuery}
      loading={loading}
      facets={facets}
      searchPlaceholder={t("table.search")}
      selectable={false}
      emptyState={{ title: t("table.empty.title"), description: t("table.empty.description") }}
    />
  );
}
