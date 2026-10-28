"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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
import type { CurrencyDTO } from "@/lib/validators/catalogs";
import { updateCurrencyAction } from "../actions";
import { CurrencyFormDialog, type CurrencyFormTarget } from "./currency-form-dialog";

type CurrenciesTableProps = {
  /** Every currency, active or not (Settings reads with `includeInactive`). */
  rows: CurrencyDTO[];
};

const helper = createDataTableColumnHelper<CurrencyDTO>();

// Settings → Monedas (PRD §8.15): the small catalog, the create and edit dialog and activation (C19: a currency
// is retired by deactivating it). USD is the reference of every rate, so its switch is locked.
export function CurrenciesTable({ rows }: CurrenciesTableProps) {
  const t = useTranslations("catalogs.currencies");
  const tShared = useTranslations("catalogs.shared");
  const tErrors = useTranslations("common.errors");
  const router = useRouter();
  const [target, setTarget] = useState<CurrencyFormTarget>(null);
  const [pending, startTransition] = useTransition();

  function setActive(currency: CurrencyDTO, active: boolean) {
    startTransition(async () => {
      const result = await updateCurrencyAction({ ...currency, active });
      if (!result.ok) {
        toast.error(tErrors(result.error.code));
        return;
      }
      toast.success(active ? t("toast.activated") : t("toast.deactivated"));
      router.refresh();
    });
  }

  const newButton = (
    <Button onClick={() => setTarget({ mode: "create" })}>
      <Plus aria-hidden />
      {t("table.new")}
    </Button>
  );

  const columns: DataTableColumnDef<CurrencyDTO>[] = [
    helper.accessor("code", {
      header: t("table.columns.code"),
      cell: ({ getValue }) => <span className="font-mono font-medium">{getValue()}</span>,
      meta: { label: t("table.columns.code"), pinned: true },
      size: 100,
    }),
    helper.accessor("name", {
      header: t("table.columns.name"),
      meta: { label: t("table.columns.name") },
      size: 200,
    }),
    helper.accessor("symbol", {
      header: t("table.columns.symbol"),
      meta: { label: t("table.columns.symbol") },
      size: 100,
    }),
    helper.accessor("decimals", {
      header: t("table.columns.decimals"),
      meta: { label: t("table.columns.decimals"), align: "end" },
      size: 110,
    }),
    helper.display({
      id: "status",
      header: t("table.columns.status"),
      cell: ({ row }) => {
        const currency = row.original;
        return (
          <div className="flex items-center gap-2">
            <Switch
              checked={currency.active}
              disabled={pending || currency.code === "USD"}
              onCheckedChange={(checked) => setActive(currency, checked)}
              aria-label={t("table.toggle", { name: currency.name })}
            />
            <Badge variant={currency.active ? "secondary" : "outline"}>
              {currency.active ? tShared("active") : tShared("inactive")}
            </Badge>
          </div>
        );
      },
      meta: { label: t("table.columns.status") },
      size: 170,
    }),
    helper.display({
      id: "actions",
      header: t("table.columns.actions"),
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setTarget({ mode: "edit", currency: row.original })}
          aria-label={t("table.edit", { name: row.original.name })}
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
      <div className="flex justify-end">{newButton}</div>
      <DataTable
        variant="compact"
        data={rows}
        columns={columns}
        getRowId={(row) => row.code}
        emptyState={{ title: t("table.empty.title"), description: t("table.empty.description") }}
      />

      <CurrencyFormDialog
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
