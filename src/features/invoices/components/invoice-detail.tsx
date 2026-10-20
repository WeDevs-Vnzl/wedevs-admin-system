"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Send, Archive } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { DetailGraphToggle } from "@/components/patterns/detail-header";
import { DetailTabs, type DetailTab } from "@/components/patterns/detail-tabs";
import { MoneyText } from "@/components/patterns/money-text";
import { PageHeader } from "@/components/patterns/page-header";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  createDataTableColumnHelper,
  type DataTableColumnDef,
} from "@/components/ui/data-table";
import { archiveInvoiceAction, issueDraftAction } from "@/features/invoices/actions";
import { InvoiceFilePanel } from "@/features/invoices/components/invoice-file-panel";
import { InvoiceLinesTable } from "@/features/invoices/components/invoice-lines-table";
import { InvoiceTotalsPanel } from "@/features/invoices/components/invoice-totals-panel";
import { VoidInvoiceDialog } from "@/features/invoices/components/void-invoice-dialog";
import { sumMoney } from "@/lib/money";
import type { InvoiceAllocationRow, InvoiceDetailDTO } from "@/lib/validators/invoices";

type InvoiceDetailProps = {
  invoice: InvoiceDetailDTO;
  canUpdate: boolean;
};

const allocationHelper = createDataTableColumnHelper<InvoiceAllocationRow>();

/**
 * `/invoices/[id]` (PRD §8.5): the header with its status and actions, then three tabs: the lines with the per-rate
 * totals, the payments that allocate to the invoice, and the "Archivo" with the PDF of the real invoice (CA4).
 * The "Detalle | Grafo" toggle opens `/invoices/[id]/graph` (A4).
 */
export function InvoiceDetail({ invoice, canUpdate }: InvoiceDetailProps) {
  const t = useTranslations("invoices");
  const tErrors = useTranslations("common.errors");
  const router = useRouter();
  const isVoided = invoice.voidedAt !== null;
  const editable = canUpdate && !isVoided;

  async function onIssue() {
    const result = await issueDraftAction({ id: invoice.id });
    if (!result.ok) {
      toast.error(tErrors(result.error.code));
      return;
    }
    toast.success(t("toast.issued"));
    router.refresh();
  }

  async function onArchive() {
    const result = await archiveInvoiceAction({ id: invoice.id });
    if (!result.ok) {
      toast.error(tErrors(result.error.code));
      return;
    }
    toast.success(t("toast.archived"));
    router.push("/invoices/list");
  }

  const allocationColumns: DataTableColumnDef<InvoiceAllocationRow>[] = [
    allocationHelper.display({
      id: "payment",
      header: t("payments.columns.payment"),
      cell: ({ row }) => row.original.payment.label,
      meta: { label: t("payments.columns.payment"), pinned: true },
      size: 160,
    }),
    allocationHelper.accessor("paymentDate", {
      header: t("payments.columns.date"),
      meta: { label: t("payments.columns.date") },
      size: 120,
    }),
    allocationHelper.display({
      id: "amount",
      header: t("payments.columns.amount"),
      cell: ({ row }) => (
        <MoneyText amount={row.original.amountInvoiceCurrency} currency={invoice.currency} />
      ),
      meta: { label: t("payments.columns.amount"), align: "end" },
      size: 150,
    }),
    allocationHelper.display({
      id: "amountUsd",
      header: t("payments.columns.amountUsd"),
      cell: ({ row }) => <MoneyText amount={row.original.amountUsd} currency="USD" />,
      meta: { label: t("payments.columns.amountUsd"), align: "end" },
      size: 150,
    }),
  ];

  const tabs: DetailTab[] = [
    {
      value: "lines",
      label: t("detail.tabs.lines"),
      content: (
        <div className="flex flex-col gap-6">
          <InvoiceLinesTable lines={invoice.lines} currency={invoice.currency} />
          <InvoiceTotalsPanel
            totals={{
              subtotal: invoice.totals.subtotal,
              discount: invoice.totals.discount,
              exemptAmount: invoice.totals.exemptAmount,
              taxBase: invoice.totals.taxBase,
              ivaAmount: invoice.totals.ivaAmount,
              total: invoice.totals.total,
              withholdings: sumWithholdings(invoice),
              receivable: invoice.totals.receivable,
              totalUsd: invoice.totals.totalUsd,
              receivableUsd: invoice.totals.receivableUsd,
              taxLines: invoice.taxLines.map((line) => ({
                ivaRate: line.ivaRate,
                taxBase: line.taxBase,
                ivaAmount: line.ivaAmount,
                adjustment: line.adjustment,
              })),
            }}
            currency={invoice.currency}
          />
        </div>
      ),
    },
    {
      value: "payments",
      label: t("detail.tabs.payments"),
      content: (
        <DataTable
          variant="compact"
          data={invoice.allocations}
          columns={allocationColumns}
          getRowId={(row) => row.id}
          emptyState={{
            title: t("payments.empty.title"),
            description: t("payments.empty.description"),
          }}
        />
      ),
    },
    {
      value: "file",
      label: t("detail.tabs.file"),
      content: <InvoiceFilePanel invoiceId={invoice.id} file={invoice.file} canUpdate={editable} />,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={invoice.invoiceNumber}
        description={`${invoice.code} · ${invoice.client.label}`}
        views={
          <DetailGraphToggle
            mode="detail"
            detailHref={`/invoices/${invoice.id}`}
            graphHref={`/invoices/${invoice.id}/graph`}
          />
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge enumName="InvoiceStatus" value={invoice.status} />
            {editable ? (
              <Button variant="outline" asChild>
                <Link href={`/invoices/${invoice.id}/edit`}>
                  <Pencil aria-hidden />
                  {t("detail.actions.edit")}
                </Link>
              </Button>
            ) : null}
            {editable && invoice.isDraft ? (
              <Button variant="outline" onClick={() => void onIssue()}>
                <Send aria-hidden />
                {t("detail.actions.issue")}
              </Button>
            ) : null}
            {editable ? (
              <VoidInvoiceDialog invoiceId={invoice.id} invoiceNumber={invoice.invoiceNumber} />
            ) : null}
            {editable ? (
              <Button variant="ghost" onClick={() => void onArchive()}>
                <Archive aria-hidden />
                {t("detail.actions.archive")}
              </Button>
            ) : null}
          </div>
        }
      />

      {isVoided ? (
        <p className="rounded-md border border-destructive/40 p-3 text-sm">
          {t("detail.voided", { reason: invoice.voidReason ?? "" })}
        </p>
      ) : null}

      <DetailTabs tabs={tabs} defaultTab="lines" />
    </div>
  );
}

/** The withholdings stored on the invoice, summed with `Decimal` (PRD §9). */
function sumWithholdings(invoice: InvoiceDetailDTO): string {
  return sumMoney([
    invoice.totals.ivaWithheld,
    invoice.totals.islrWithheld,
    invoice.totals.otherWithheld,
  ]);
}
