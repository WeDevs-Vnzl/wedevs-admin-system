import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { DateText } from "@/components/patterns/date-text";
import { MoneyText } from "@/components/patterns/money-text";
import { RelatedMiniTable } from "@/components/patterns/related-mini-table";
import { StatusBadge } from "@/components/patterns/status-badge";
import { listInvoices } from "@/features/invoices/queries";

type RelatedInvoicesTabProps = {
  /** The client or the project whose invoices the tab lists. */
  filter: { clientId: string } | { projectId: string };
  /** "+ Nuevo" target; omitted for roles that may not create invoices. */
  newHref?: string;
};

/**
 * "Facturas" tab of the client and project detail (PRD §8.2, §8.3): the record's non-archived invoices, newest
 * first, read through the invoices query so the rows match `/invoices/list`.
 */
export async function RelatedInvoicesTab({ filter, newHref }: RelatedInvoicesTabProps) {
  const t = await getTranslations("invoices");
  const page = await listInvoices({ ...filter, pageSize: 100, sort: "issueDate:desc" });

  return (
    <RelatedMiniTable
      title={t("page.listTitle")}
      headers={[
        t("table.columns.invoiceNumber"),
        t("table.columns.issueDate"),
        t("table.columns.status"),
        { label: t("table.columns.total"), align: "end" },
        { label: t("table.columns.balance"), align: "end" },
      ]}
      rows={page.items.map((row) => ({
        id: row.id,
        cells: [
          <Link key="number" href={`/invoices/${row.id}`} className="font-medium hover:underline">
            {row.invoiceNumber}
          </Link>,
          <DateText key="issued" value={row.issueDate} />,
          <StatusBadge key="status" enumName="InvoiceStatus" value={row.status} />,
          <div key="total" className="text-end tabular-nums">
            <MoneyText amount={row.total} currency={row.currency} />
          </div>,
          <div key="balance" className="text-end tabular-nums">
            <MoneyText amount={row.balance} currency={row.currency} />
          </div>,
        ],
      }))}
      newHref={newHref}
    />
  );
}
