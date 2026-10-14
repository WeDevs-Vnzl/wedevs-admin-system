"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  createDataTableColumnHelper,
  type DataTableColumnDef,
} from "@/components/ui/data-table";
import { Switch } from "@/components/ui/switch";
import type { PaymentMethodDTO } from "@/lib/validators/catalogs";
import { updatePaymentMethodAction } from "../actions";
import { catalogLabel } from "./catalog-label";
import {
  PaymentMethodFormDialog,
  type PaymentMethodFormTarget,
} from "./payment-method-form-dialog";

type PaymentMethodsTableProps = {
  /** Every payment method, active or not. */
  rows: PaymentMethodDTO[];
};

const helper = createDataTableColumnHelper<PaymentMethodDTO>();

// Settings → Métodos de pago (PRD §8.15): name, reference and IGTF flags (DT-70: `suggestsIgtf` is one of the two
// sources of the IGTF proposal), activation instead of delete (C19).
export function PaymentMethodsTable({ rows }: PaymentMethodsTableProps) {
  const t = useTranslations("catalogs.paymentMethods");
  const tShared = useTranslations("catalogs.shared");
  const tErrors = useTranslations("common.errors");
  const locale = useLocale();
  const router = useRouter();
  const [target, setTarget] = useState<PaymentMethodFormTarget>(null);
  const [pending, startTransition] = useTransition();

  function setActive(method: PaymentMethodDTO, active: boolean) {
    startTransition(async () => {
      const result = await updatePaymentMethodAction({
        id: method.id,
        name: method.name,
        nameEn: method.nameEn ?? undefined,
        requiresReference: method.requiresReference,
        suggestsIgtf: method.suggestsIgtf,
        active,
      });
      if (!result.ok) {
        toast.error(tErrors(result.error.code));
        return;
      }
      toast.success(active ? t("toast.activated") : t("toast.deactivated"));
      router.refresh();
    });
  }

  const flag = (value: boolean) => (
    <Badge variant={value ? "secondary" : "outline"}>
      {value ? tShared("yes") : tShared("no")}
    </Badge>
  );

  const columns: DataTableColumnDef<PaymentMethodDTO>[] = [
    helper.display({
      id: "name",
      header: t("table.columns.name"),
      cell: ({ row }) => <span className="font-medium">{catalogLabel(row.original, locale)}</span>,
      meta: { label: t("table.columns.name"), pinned: true },
      size: 200,
    }),
    helper.accessor("code", {
      header: t("table.columns.code"),
      cell: ({ getValue }) => (
        <span className="font-mono text-xs text-muted-foreground">{getValue()}</span>
      ),
      meta: { label: t("table.columns.code") },
      size: 140,
    }),
    helper.accessor("requiresReference", {
      header: t("table.columns.requiresReference"),
      cell: ({ getValue }) => flag(getValue()),
      meta: { label: t("table.columns.requiresReference") },
      size: 160,
    }),
    helper.accessor("suggestsIgtf", {
      header: t("table.columns.suggestsIgtf"),
      cell: ({ getValue }) => flag(getValue()),
      meta: { label: t("table.columns.suggestsIgtf") },
      size: 160,
    }),
    helper.display({
      id: "status",
      header: t("table.columns.status"),
      cell: ({ row }) => {
        const method = row.original;
        return (
          <div className="flex items-center gap-2">
            <Switch
              checked={method.active}
              disabled={pending}
              onCheckedChange={(checked) => setActive(method, checked)}
              aria-label={t("table.toggle", { name: catalogLabel(method, locale) })}
            />
            <span className="text-sm text-muted-foreground">
              {method.active ? tShared("active") : tShared("inactive")}
            </span>
          </div>
        );
      },
      meta: { label: t("table.columns.status") },
      size: 160,
    }),
    helper.display({
      id: "actions",
      header: t("table.columns.actions"),
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setTarget({ mode: "edit", method: row.original })}
          aria-label={t("table.edit", { name: catalogLabel(row.original, locale) })}
        >
          <Pencil aria-hidden />
        </Button>
      ),
      meta: { label: t("table.columns.actions"), hideable: false, exportable: false, align: "end" },
      size: 100,
    }),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={() => setTarget({ mode: "create" })}>
          <Plus aria-hidden />
          {t("table.new")}
        </Button>
      </div>
      <DataTable
        variant="compact"
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        emptyState={{ title: t("table.empty.title"), description: t("table.empty.description") }}
      />

      <PaymentMethodFormDialog
        target={target}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
        onSaved={() => {
          setTarget(null);
          router.refresh();
        }}
      />
    </div>
  );
}
