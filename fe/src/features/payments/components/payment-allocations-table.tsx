"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { MoneyText } from "@/components/patterns/money-text";
import {
  DataTable,
  createDataTableColumnHelper,
  type DataTableColumnDef,
} from "@/components/ui/data-table";
import type { PaymentAllocationDTO } from "@/lib/validators/payments";

type PaymentAllocationsTableProps = {
  rows: PaymentAllocationDTO[];
  currency: string;
};

const helper = createDataTableColumnHelper<PaymentAllocationDTO>();

/** Invoices a payment was applied to (PRD §8.6 "Asignaciones"), both amounts as stored at write time. */
export function PaymentAllocationsTable({ rows, currency }: PaymentAllocationsTableProps) {
  const t = useTranslations("payments.detail");

  const columns: DataTableColumnDef<PaymentAllocationDTO>[] = [
    helper.display({
      id: "invoice",
      header: t("invoice"),
      cell: ({ row }) => (
        <Link
          className="font-medium underline-offset-4 hover:underline"
          href={`/invoices/${row.original.invoice.id}`}
        >
          {row.original.invoice.label}
        </Link>
      ),
      meta: { label: t("invoice"), pinned: true },
      size: 200,
    }),
    helper.display({
      id: "amountPaymentCurrency",
      header: t("amountPayment"),
      cell: ({ row }) => (
        <MoneyText amount={row.original.amountPaymentCurrency} currency={currency} />
      ),
      meta: { label: t("amountPayment"), align: "end" },
      size: 200,
    }),
    helper.display({
      id: "amountInvoiceCurrency",
      header: t("amountInvoice"),
      cell: ({ row }) => (
        <MoneyText
          amount={row.original.amountInvoiceCurrency}
          currency={row.original.invoiceCurrency}
        />
      ),
      meta: { label: t("amountInvoice"), align: "end" },
      size: 200,
    }),
    helper.display({
      id: "amountUsd",
      header: t("amountUsd"),
      cell: ({ row }) => <MoneyText amount={row.original.amountUsd} currency="USD" />,
      meta: { label: t("amountUsd"), align: "end" },
      size: 140,
    }),
  ];

  return (
    <DataTable
      variant="compact"
      data={rows}
      columns={columns}
      getRowId={(row) => row.id}
      emptyState={{ title: t("allocationsEmpty"), description: t("allocationsDescription") }}
    />
  );
}
