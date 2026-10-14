"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Ban, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { MoneyText } from "@/components/patterns/money-text";
import { SectionCard } from "@/components/patterns/section-card";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  createDataTableColumnHelper,
  type DataTableColumnDef,
} from "@/components/ui/data-table";
import { formatDate } from "@/lib/dates";
import type { InstallmentDTO } from "@/lib/validators/billing";
import { cancelInstallmentAction } from "../actions";
import {
  InstallmentFormDialog,
  type CurrencyOption,
  type InstallmentFormTarget,
} from "./installment-form-dialog";

type InstallmentsTableProps = {
  projectId: string;
  installments: readonly InstallmentDTO[];
  currencies: readonly CurrencyOption[];
  defaultCurrency: string;
  canEdit: boolean;
};

const helper = createDataTableColumnHelper<InstallmentDTO>();

// HU-09 CA1–CA3: the installments of the project in order, with their derived status and lock. Billed rows keep
// their amount and currency; cancelled rows stay listed.
export function InstallmentsTable({
  projectId,
  installments,
  currencies,
  defaultCurrency,
  canEdit,
}: InstallmentsTableProps) {
  const t = useTranslations("billing.installments");
  const tEnums = useTranslations("enums");
  const tRoot = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const [formTarget, setFormTarget] = useState<InstallmentFormTarget>(null);
  const [cancelTarget, setCancelTarget] = useState<InstallmentDTO | null>(null);
  const [pending, startTransition] = useTransition();

  function confirmCancel() {
    const target = cancelTarget;
    if (!target) return;
    startTransition(async () => {
      const result = await cancelInstallmentAction({ id: target.id });
      if (!result.ok) {
        toast.error(tRoot(result.error.message as never));
        return;
      }
      setCancelTarget(null);
      toast.success(t("toast.cancelled"));
      router.refresh();
    });
  }

  const columns = useMemo<DataTableColumnDef<InstallmentDTO>[]>(
    () => [
      helper.accessor("order", {
        header: t("columns.order"),
        cell: ({ getValue }) => <span className="tabular-nums">{getValue() + 1}</span>,
        meta: { label: t("columns.order") },
      }),
      helper.accessor("label", {
        header: t("columns.label"),
        cell: ({ row }) => (
          <span
            className={row.original.cancelledAt ? "text-muted-foreground line-through" : undefined}
          >
            {row.original.label}
          </span>
        ),
        meta: { label: t("columns.label") },
      }),
      helper.accessor("kind", {
        header: t("columns.kind"),
        cell: ({ getValue }) => tEnums(`InstallmentKind.${getValue()}`),
        meta: { label: t("columns.kind") },
      }),
      helper.accessor("amount", {
        header: t("columns.amount"),
        cell: ({ row }) => (
          <span className="inline-flex flex-col items-end gap-0.5">
            <MoneyText amount={row.original.amount} currency={row.original.currency} />
            {row.original.locked ? (
              <span className="text-xs text-muted-foreground">{t("locked")}</span>
            ) : null}
          </span>
        ),
        meta: { label: t("columns.amount") },
      }),
      helper.accessor("percentage", {
        header: t("columns.percentage"),
        cell: ({ getValue }) => {
          const value = getValue();
          return value === null ? "—" : <span className="tabular-nums">{value} %</span>;
        },
        meta: { label: t("columns.percentage") },
      }),
      helper.accessor("dueDate", {
        header: t("columns.dueDate"),
        cell: ({ getValue }) => {
          const value = getValue();
          return value === null ? "—" : formatDate(value, locale);
        },
        meta: { label: t("columns.dueDate") },
      }),
      helper.accessor("status", {
        header: t("columns.status"),
        cell: ({ getValue }) => <StatusBadge enumName="InstallmentStatus" value={getValue()} />,
        meta: { label: t("columns.status") },
      }),
      helper.display({
        id: "actions",
        header: t("columns.actions"),
        cell: ({ row }) => {
          const item = row.original;
          if (!canEdit || item.cancelledAt !== null) return null;
          return (
            <div className="flex items-center justify-end gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("edit", { label: item.label })}
                onClick={() => setFormTarget({ mode: "edit", installment: item })}
              >
                <Pencil aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("cancel", { label: item.label })}
                disabled={item.locked}
                onClick={() => setCancelTarget(item)}
              >
                <Ban aria-hidden />
              </Button>
            </div>
          );
        },
        meta: { label: t("columns.actions"), hideable: false, exportable: false },
      }),
    ],
    [canEdit, locale, t, tEnums],
  );

  return (
    <SectionCard
      title={t("title")}
      description={t("description")}
      actions={
        canEdit ? (
          <Button type="button" size="sm" onClick={() => setFormTarget({ mode: "create" })}>
            <Plus aria-hidden />
            {t("add")}
          </Button>
        ) : null
      }
    >
      <DataTable
        variant="compact"
        data={[...installments]}
        columns={columns}
        getRowId={(row) => row.id}
        emptyState={{ title: t("empty.title"), description: t("empty.description") }}
      />
      <InstallmentFormDialog
        projectId={projectId}
        currencies={currencies}
        defaultCurrency={defaultCurrency}
        target={formTarget}
        onOpenChange={(open) => {
          if (!open) setFormTarget(null);
        }}
        onSaved={() => setFormTarget(null)}
      />
      <ConfirmDialog
        variant="cancel"
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null);
        }}
        description={t("cancelDescription", { label: cancelTarget?.label ?? "" })}
        pending={pending}
        onConfirm={confirmCancel}
      />
    </SectionCard>
  );
}
