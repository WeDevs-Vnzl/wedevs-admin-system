import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { DateText } from "@/components/patterns/date-text";
import { MoneyText } from "@/components/patterns/money-text";
import { RelatedMiniTable } from "@/components/patterns/related-mini-table";
import { StatusBadge } from "@/components/patterns/status-badge";
import { listExpenses } from "@/features/expenses/queries";

type ProjectExpensesTabProps = {
  projectId: string;
  /** "+ Nuevo" target; omitted for roles that may not create expenses. */
  newHref?: string;
};

/**
 * "Gastos" tab of the project detail (PRD §8.3): the expenses charged to the project, newest first, read through
 * the expenses query so the rows match `/expenses/list`.
 */
export async function ProjectExpensesTab({ projectId, newHref }: ProjectExpensesTabProps) {
  const t = await getTranslations("expenses");
  const page = await listExpenses({ projectId, pageSize: 100, sort: "date:desc" });

  return (
    <RelatedMiniTable
      title={t("page.overviewTitle")}
      headers={[
        t("table.columns.code"),
        t("table.columns.description"),
        t("table.columns.date"),
        t("table.columns.status"),
        { label: t("table.columns.amountUsd"), align: "end" },
      ]}
      rows={page.items.map((row) => ({
        id: row.id,
        cells: [
          <Link
            key="code"
            href={`/expenses/${row.id}`}
            className="font-mono text-xs hover:underline"
          >
            {row.code}
          </Link>,
          <span key="description" className="font-medium">
            {row.description}
          </span>,
          <DateText key="date" value={row.date} />,
          <StatusBadge key="status" enumName="ExpenseStatus" value={row.status} />,
          <div key="amount" className="text-end tabular-nums">
            <MoneyText amount={row.amountUsd} currency="USD" />
          </div>,
        ],
      }))}
      newHref={newHref}
    />
  );
}
