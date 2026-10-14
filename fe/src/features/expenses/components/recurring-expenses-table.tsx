"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { DateText } from "@/components/patterns/date-text";
import { MoneyText } from "@/components/patterns/money-text";
import { StatusBadge } from "@/components/patterns/status-badge";
import {
  DataTable,
  createDataTableColumnHelper,
  type DataTableColumnDef,
} from "@/components/ui/data-table";
import type { RecurringExpenseDTO } from "@/lib/validators/expenses";

type RecurringExpensesTableProps = {
  rows: RecurringExpenseDTO[];
};

const helper = createDataTableColumnHelper<RecurringExpenseDTO>();

/** Recurring expenses (PRD §8.8): the schedule of each one, with the next period still to generate. */
export function RecurringExpensesTable({ rows }: RecurringExpensesTableProps) {
  const t = useTranslations("expenses");
  const locale = useLocale();

  const columns: DataTableColumnDef<RecurringExpenseDTO>[] = [
    helper.accessor("name", {
      header: t("recurring.table.columns.name"),
      cell: ({ row }) => (
        <Link
          className="font-medium underline-offset-4 hover:underline"
          href={`/expenses/recurring/${row.original.id}`}
        >
          {row.original.name}
        </Link>
      ),
      meta: { label: t("recurring.table.columns.name"), pinned: true },
      size: 240,
    }),
    helper.accessor("category", {
      header: t("recurring.table.columns.category"),
      cell: ({ getValue }) => {
        const category = getValue();
        const english = locale === "en";
        return english && category.nameEn ? category.nameEn : category.name;
      },
      meta: { label: t("recurring.table.columns.category") },
      size: 200,
    }),
    helper.accessor("frequency", {
      header: t("recurring.table.columns.frequency"),
      cell: ({ getValue }) => <StatusBadge enumName="Frequency" value={getValue()} />,
      meta: { label: t("recurring.table.columns.frequency") },
      size: 140,
    }),
    helper.display({
      id: "amount",
      header: t("recurring.table.columns.amount"),
      cell: ({ row }) => (
        <MoneyText amount={row.original.amount} currency={row.original.currency} />
      ),
      meta: { label: t("recurring.table.columns.amount"), align: "end" },
      size: 140,
    }),
    helper.accessor("nextDueDate", {
      header: t("recurring.table.columns.nextDueDate"),
      cell: ({ getValue }) => {
        const value = getValue();
        return value ? <DateText value={value} /> : "—";
      },
      meta: { label: t("recurring.table.columns.nextDueDate") },
      size: 140,
    }),
    helper.accessor("status", {
      header: t("recurring.table.columns.status"),
      cell: ({ getValue }) => <StatusBadge enumName="RecurringStatus" value={getValue()} />,
      meta: { label: t("recurring.table.columns.status") },
      size: 140,
    }),
  ];

  return (
    <DataTable
      variant="compact"
      data={rows}
      columns={columns}
      getRowId={(row) => row.id}
      emptyState={{
        title: t("recurring.table.empty.title"),
        description: t("recurring.table.empty.description"),
      }}
    />
  );
}
