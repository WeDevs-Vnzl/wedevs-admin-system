"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { DateText } from "@/components/patterns/date-text";
import { MoneyText } from "@/components/patterns/money-text";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Badge } from "@/components/ui/badge";
import {
  DataTable,
  createDataTableColumnHelper,
  useTableUrlState,
  type DataTableColumnDef,
  type FacetConfig,
} from "@/components/ui/data-table";
import type { ListQuery } from "@/lib/validators/common";
import { EXPENSE_STATUS_VALUES } from "@/lib/validators/enums";
import type { ExpenseListRow } from "@/lib/validators/expenses";
import { listExpensesAction } from "../actions";
import type { ExpenseAccountOption, ExpenseOption } from "../form-options";
import { expenseFilterOf } from "./expense-table-query";

/** Options of the category, account and project facets, read on the server with the first page. */
export type ExpenseFacetOptions = {
  categories: ExpenseOption[];
  accounts: ExpenseAccountOption[];
  projects: ExpenseOption[];
};

type ExpensesTableProps = {
  /** First page, read on the server for the query in the URL. */
  initialRows: ExpenseListRow[];
  initialTotal: number;
  facetOptions: ExpenseFacetOptions;
};

const helper = createDataTableColumnHelper<ExpenseListRow>();

/**
 * The `/expenses/list` table (PRD §8.8, DT-25 table view): facets, search, header sort and pagination live in the
 * URL. The first render shows the server rows for the URL query; later query changes reload through
 * `listExpensesAction`. Amounts stay in their own currency with the USD snapshot next to them; a pending expense
 * past its due date is flagged as overdue.
 */
export function ExpensesTable({ initialRows, initialTotal, facetOptions }: ExpensesTableProps) {
  const t = useTranslations("expenses");
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
      const result = await listExpensesAction(expenseFilterOf(next));
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

  const columns = useMemo<DataTableColumnDef<ExpenseListRow>[]>(
    () => [
      helper.accessor("code", {
        header: t("table.columns.code"),
        cell: ({ row }) => (
          <Link
            className="font-medium underline-offset-4 hover:underline"
            href={`/expenses/${row.original.id}`}
          >
            {row.original.code}
          </Link>
        ),
        meta: { label: t("table.columns.code"), pinned: true, sortable: true },
        size: 110,
      }),
      helper.accessor("description", {
        header: t("table.columns.description"),
        cell: ({ getValue }) => <span className="line-clamp-1">{getValue()}</span>,
        meta: { label: t("table.columns.description"), sortable: true },
        size: 260,
      }),
      helper.accessor("category", {
        header: t("table.columns.category"),
        cell: ({ getValue }) => {
          const category = getValue();
          const english = locale === "en";
          const name = english && category.nameEn ? category.nameEn : category.name;
          if (!category.parent) return name;
          const parent =
            english && category.parent.nameEn ? category.parent.nameEn : category.parent.name;
          return `${parent} → ${name}`;
        },
        meta: { label: t("table.columns.category"), sortable: false },
        size: 220,
      }),
      helper.accessor("date", {
        header: t("table.columns.date"),
        cell: ({ getValue }) => <DateText value={getValue()} />,
        meta: { label: t("table.columns.date"), sortable: true },
        size: 120,
      }),
      helper.accessor("dueDate", {
        header: t("table.columns.dueDate"),
        cell: ({ getValue }) => {
          const value = getValue();
          return value ? <DateText value={value} /> : "—";
        },
        meta: { label: t("table.columns.dueDate"), sortable: true },
        size: 120,
      }),
      helper.display({
        id: "amount",
        header: t("table.columns.amount"),
        cell: ({ row }) => (
          <MoneyText amount={row.original.amount} currency={row.original.currency} />
        ),
        meta: { label: t("table.columns.amount"), align: "end", sortable: true },
        size: 140,
      }),
      helper.display({
        id: "amountUsd",
        header: t("table.columns.amountUsd"),
        cell: ({ row }) => <MoneyText amount={row.original.amountUsd} currency="USD" />,
        meta: { label: t("table.columns.amountUsd"), align: "end", sortable: true },
        size: 130,
      }),
      helper.display({
        id: "status",
        header: t("table.columns.status"),
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center gap-1">
            <StatusBadge enumName="ExpenseStatus" value={row.original.status} />
            {row.original.overdue ? (
              <Badge variant="destructive">{t("status.overdue")}</Badge>
            ) : null}
            {row.original.recurring ? (
              <Badge variant="outline">{t("status.recurring")}</Badge>
            ) : null}
          </div>
        ),
        meta: { label: t("table.columns.status"), sortable: true },
        size: 220,
      }),
    ],
    [t, locale],
  );

  const facets = useMemo<FacetConfig[]>(
    () => [
      {
        id: "status",
        label: t("facets.status"),
        kind: "options",
        options: EXPENSE_STATUS_VALUES.map((value) => ({
          value,
          label: tEnums(`ExpenseStatus.${value}`),
        })),
      },
      {
        id: "categoryId",
        label: t("facets.category"),
        kind: "options",
        options: facetOptions.categories.map(({ id, label }) => ({ value: id, label })),
      },
      {
        id: "accountId",
        label: t("facets.account"),
        kind: "options",
        options: facetOptions.accounts.map(({ id, name }) => ({ value: id, label: name })),
      },
      {
        id: "projectId",
        label: t("facets.project"),
        kind: "options",
        options: facetOptions.projects.map(({ id, label }) => ({ value: id, label })),
      },
      {
        id: "date",
        label: t("facets.date"),
        kind: "dateRange",
        fromKey: "dateFrom",
        toKey: "dateTo",
      },
    ],
    [t, tEnums, facetOptions],
  );

  return (
    <DataTable<ExpenseListRow>
      data={rows}
      columns={columns}
      getRowId={(row) => row.id}
      total={total}
      query={query}
      onQueryChange={setQuery}
      loading={loading}
      facets={facets}
      searchPlaceholder={t("search.placeholder")}
      emptyState={{ title: t("table.empty.title"), description: t("table.empty.description") }}
    />
  );
}
