"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/patterns/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CurrencyDTO } from "@/lib/validators/catalogs";
import { updateCurrencyAction } from "../actions";
import { CurrencyFormDialog, type CurrencyFormTarget } from "./currency-form-dialog";

type CurrenciesTableProps = {
  /** Every currency, active or not (Settings reads with `includeInactive`). */
  rows: CurrencyDTO[];
};

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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">{newButton}</div>
      {rows.length === 0 ? (
        <EmptyState title={t("table.empty.title")} description={t("table.empty.description")} />
      ) : (
        <div className="rounded-2xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("table.columns.code")}</TableHead>
                <TableHead>{t("table.columns.name")}</TableHead>
                <TableHead>{t("table.columns.symbol")}</TableHead>
                <TableHead className="text-right">{t("table.columns.decimals")}</TableHead>
                <TableHead>{t("table.columns.status")}</TableHead>
                <TableHead className="text-right">{t("table.columns.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((currency) => (
                <TableRow key={currency.code}>
                  <TableCell className="font-mono font-medium">{currency.code}</TableCell>
                  <TableCell>{currency.name}</TableCell>
                  <TableCell>{currency.symbol}</TableCell>
                  <TableCell className="text-right tabular-nums">{currency.decimals}</TableCell>
                  <TableCell>
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
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setTarget({ mode: "edit", currency })}
                      aria-label={t("table.edit", { name: currency.name })}
                    >
                      <Pencil aria-hidden />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

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
