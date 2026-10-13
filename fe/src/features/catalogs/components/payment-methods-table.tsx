"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={() => setTarget({ mode: "create" })}>
          <Plus aria-hidden />
          {t("table.new")}
        </Button>
      </div>
      {rows.length === 0 ? (
        <EmptyState title={t("table.empty.title")} description={t("table.empty.description")} />
      ) : (
        <div className="rounded-2xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("table.columns.name")}</TableHead>
                <TableHead>{t("table.columns.code")}</TableHead>
                <TableHead>{t("table.columns.requiresReference")}</TableHead>
                <TableHead>{t("table.columns.suggestsIgtf")}</TableHead>
                <TableHead>{t("table.columns.status")}</TableHead>
                <TableHead className="text-right">{t("table.columns.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((method) => {
                const label = catalogLabel(method, locale);
                return (
                  <TableRow key={method.id}>
                    <TableCell className="font-medium">{label}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {method.code}
                    </TableCell>
                    <TableCell>{flag(method.requiresReference)}</TableCell>
                    <TableCell>{flag(method.suggestsIgtf)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={method.active}
                          disabled={pending}
                          onCheckedChange={(checked) => setActive(method, checked)}
                          aria-label={t("table.toggle", { name: label })}
                        />
                        <span className="text-sm text-muted-foreground">
                          {method.active ? tShared("active") : tShared("inactive")}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setTarget({ mode: "edit", method })}
                        aria-label={t("table.edit", { name: label })}
                      >
                        <Pencil aria-hidden />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

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
