"use client";

import { useTranslations } from "next-intl";
import { MoneyText } from "@/components/patterns/money-text";
import {
  DataTable,
  createDataTableColumnHelper,
  type DataTableColumnDef,
} from "@/components/ui/data-table";
import type { InvoiceLineDTO } from "@/lib/validators/invoices";

type InvoiceLinesTableProps = {
  lines: InvoiceLineDTO[];
  currency: string;
};

const helper = createDataTableColumnHelper<InvoiceLineDTO>();

/** Lines of an invoice with their own VAT rate (DT-44); an exempt line shows the exempt label. */
export function InvoiceLinesTable({ lines, currency }: InvoiceLinesTableProps) {
  const t = useTranslations("invoices");

  const columns: DataTableColumnDef<InvoiceLineDTO>[] = [
    helper.accessor("description", {
      header: t("lines.columns.description"),
      meta: { label: t("lines.columns.description"), pinned: true },
      size: 260,
    }),
    helper.display({
      id: "source",
      header: t("lines.columns.source"),
      cell: ({ row }) => row.original.installment?.label ?? row.original.project?.label ?? "—",
      meta: { label: t("lines.columns.source") },
      size: 200,
    }),
    helper.accessor("quantity", {
      header: t("lines.columns.quantity"),
      meta: { label: t("lines.columns.quantity"), align: "end" },
      size: 90,
    }),
    helper.display({
      id: "unitPrice",
      header: t("lines.columns.unitPrice"),
      cell: ({ row }) => <MoneyText amount={row.original.unitPrice} currency={currency} />,
      meta: { label: t("lines.columns.unitPrice"), align: "end" },
      size: 130,
    }),
    helper.accessor("discount", {
      header: t("lines.columns.discount"),
      cell: ({ getValue }) => <MoneyText amount={getValue()} currency={currency} />,
      meta: { label: t("lines.columns.discount"), align: "end" },
      size: 120,
    }),
    helper.display({
      id: "netAmount",
      header: t("lines.columns.netAmount"),
      cell: ({ row }) => <MoneyText amount={row.original.netAmount} currency={currency} />,
      meta: { label: t("lines.columns.netAmount"), align: "end" },
      size: 130,
    }),
    helper.display({
      id: "ivaRate",
      header: t("lines.columns.ivaRate"),
      cell: ({ row }) =>
        row.original.ivaRate === null
          ? t("form.line.exempt")
          : t("rate", { rate: row.original.ivaRate }),
      meta: { label: t("lines.columns.ivaRate") },
      size: 110,
    }),
  ];

  return (
    <DataTable
      variant="compact"
      data={lines}
      columns={columns}
      getRowId={(row) => row.id}
      emptyState={{ title: t("lines.empty.title"), description: t("lines.empty.description") }}
    />
  );
}
