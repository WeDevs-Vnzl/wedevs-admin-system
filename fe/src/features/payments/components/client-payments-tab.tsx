import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { DateText } from "@/components/patterns/date-text";
import { MoneyText } from "@/components/patterns/money-text";
import { RelatedMiniTable } from "@/components/patterns/related-mini-table";
import { ListCode, SimpleListCard } from "@/components/patterns/simple-list-card";
import { StatusBadge } from "@/components/patterns/status-badge";
import { getClientCredit, listPayments } from "@/features/payments/queries";

type ClientPaymentsTabProps = {
  clientId: string;
  /** "+ Nuevo" target; omitted for roles that may not register payments. */
  newHref?: string;
};

/**
 * "Pagos" tab of the client detail (PRD §8.2): the saldo a favor from `getClientCredit` (HU-13 CA5) and the
 * client's payments, newest first, read through the payments queries.
 */
export async function ClientPaymentsTab({ clientId, newHref }: ClientPaymentsTabProps) {
  const t = await getTranslations("payments");
  const [credit, page] = await Promise.all([
    getClientCredit(clientId),
    listPayments({ clientId, pageSize: 100, sort: "date:desc" }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <SimpleListCard
        title={t("credit.title")}
        description={t("credit.description")}
        emptyTitle={t("credit.empty")}
        rows={credit.payments.map((item) => ({
          id: item.paymentId,
          label: (
            <ListCode
              href={`/payments/${item.paymentId}`}
              code={item.code}
              name={<DateText value={item.date} />}
            />
          ),
          values: [{ node: <MoneyText amount={item.unallocated} currency={item.currency} /> }],
        }))}
      />
      <RelatedMiniTable
        title={t("page.listTitle")}
        headers={[
          t("table.columns.code"),
          t("table.columns.date"),
          t("table.columns.method"),
          t("table.columns.status"),
          { label: t("table.columns.amount"), align: "end" },
        ]}
        rows={page.items.map((row) => ({
          id: row.id,
          cells: [
            <Link
              key="code"
              href={`/payments/${row.id}`}
              className="font-mono text-xs hover:underline"
            >
              {row.code}
            </Link>,
            <DateText key="date" value={row.date} />,
            <span key="method">{row.method.name}</span>,
            <StatusBadge key="status" enumName="PaymentStatus" value={row.status} />,
            <div key="amount" className="text-end tabular-nums">
              <MoneyText amount={row.amount} currency={row.currency} />
            </div>,
          ],
        }))}
        newHref={newHref}
      />
    </div>
  );
}
