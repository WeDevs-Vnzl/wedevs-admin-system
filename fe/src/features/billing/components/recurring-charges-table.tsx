"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { CalendarPlus, Pause, Pencil, Play, Plus, Square } from "lucide-react";
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
import type { RecurringChargeDTO } from "@/lib/validators/billing";
import { generateMissingPeriodsAction, setRecurringChargeStatusAction } from "../actions";
import type { CurrencyOption } from "./installment-form-dialog";
import {
  RecurringChargeFormDialog,
  type RecurringChargeFormTarget,
} from "./recurring-charge-form-dialog";

type RecurringChargesTableProps = {
  projectId: string;
  charges: readonly RecurringChargeDTO[];
  currencies: readonly CurrencyOption[];
  defaultCurrency: string;
  canEdit: boolean;
};

const helper = createDataTableColumnHelper<RecurringChargeDTO>();

// HU-10: the monthly charges of the project. Pausing stops the generation (CA3); generation is idempotent (CA2).
export function RecurringChargesTable({
  projectId,
  charges,
  currencies,
  defaultCurrency,
  canEdit,
}: RecurringChargesTableProps) {
  const t = useTranslations("billing.recurring");
  const tEnums = useTranslations("enums");
  const tRoot = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const [formTarget, setFormTarget] = useState<RecurringChargeFormTarget>(null);
  const [finishTarget, setFinishTarget] = useState<RecurringChargeDTO | null>(null);
  const [pending, startTransition] = useTransition();

  function run(
    task: () => Promise<{ ok: true } | { ok: false; error: { message: string } }>,
    onDone?: () => void,
  ) {
    startTransition(async () => {
      const result = await task();
      if (!result.ok) {
        toast.error(tRoot(result.error.message as never));
        return;
      }
      onDone?.();
      router.refresh();
    });
  }

  function setStatus(charge: RecurringChargeDTO, status: RecurringChargeDTO["status"]) {
    run(
      () => setRecurringChargeStatusAction({ id: charge.id, status }),
      () =>
        toast.success(
          status === "PAUSADO"
            ? t("toast.paused")
            : status === "ACTIVO"
              ? t("toast.resumed")
              : t("toast.finished"),
        ),
    );
  }

  function generate(charge: RecurringChargeDTO) {
    run(
      () => generateMissingPeriodsAction({ recurringChargeId: charge.id }),
      () => toast.success(t("toast.generated")),
    );
  }

  const columns: DataTableColumnDef<RecurringChargeDTO>[] = [
    helper.accessor("label", {
      header: t("columns.label"),
      meta: { label: t("columns.label") },
    }),
    helper.accessor("amount", {
      header: t("columns.amount"),
      cell: ({ row }) => (
        <span className="inline-flex flex-col items-end gap-0.5">
          <MoneyText amount={row.original.amount} currency={row.original.currency} />
          <span className="text-xs text-muted-foreground">
            {t("monthly", {
              amount: row.original.monthlyAmount,
              currency: row.original.currency,
            })}
          </span>
        </span>
      ),
      meta: { label: t("columns.amount") },
    }),
    helper.accessor("frequency", {
      header: t("columns.frequency"),
      cell: ({ getValue }) => tEnums(`Frequency.${getValue()}`),
      meta: { label: t("columns.frequency") },
    }),
    helper.accessor("billingDay", {
      header: t("columns.billingDay"),
      cell: ({ row }) =>
        t("billingDay", { day: row.original.billingDay, lead: row.original.leadDays }),
      meta: { label: t("columns.billingDay") },
    }),
    helper.accessor("lastGeneratedPeriodStart", {
      header: t("columns.lastGenerated"),
      cell: ({ getValue }) => {
        const value = getValue();
        return value === null ? "—" : formatDate(value, locale);
      },
      meta: { label: t("columns.lastGenerated") },
    }),
    helper.accessor("status", {
      header: t("columns.status"),
      cell: ({ getValue }) => <StatusBadge enumName="RecurringStatus" value={getValue()} />,
      meta: { label: t("columns.status") },
    }),
    helper.display({
      id: "actions",
      header: t("columns.actions"),
      cell: ({ row }) => {
        const charge = row.original;
        if (!canEdit || charge.status === "FINALIZADO") return null;
        const paused = charge.status === "PAUSADO";
        return (
          <div className="flex items-center justify-end gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("generate", { label: charge.label })}
              disabled={pending}
              onClick={() => generate(charge)}
            >
              <CalendarPlus aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={
                paused ? t("resume", { label: charge.label }) : t("pause", { label: charge.label })
              }
              disabled={pending}
              onClick={() => setStatus(charge, paused ? "ACTIVO" : "PAUSADO")}
            >
              {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("edit", { label: charge.label })}
              onClick={() => setFormTarget({ mode: "edit", charge })}
            >
              <Pencil aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("finish", { label: charge.label })}
              disabled={pending}
              onClick={() => setFinishTarget(charge)}
            >
              <Square aria-hidden />
            </Button>
          </div>
        );
      },
      meta: { label: t("columns.actions"), hideable: false, exportable: false },
    }),
  ];

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
        data={[...charges]}
        columns={columns}
        getRowId={(row) => row.id}
        emptyState={{ title: t("empty.title"), description: t("empty.description") }}
      />
      <RecurringChargeFormDialog
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
        open={finishTarget !== null}
        onOpenChange={(open) => {
          if (!open) setFinishTarget(null);
        }}
        description={t("finishDescription", { label: finishTarget?.label ?? "" })}
        pending={pending}
        onConfirm={() => {
          const target = finishTarget;
          if (!target) return;
          setFinishTarget(null);
          setStatus(target, "FINALIZADO");
        }}
      />
    </SectionCard>
  );
}
