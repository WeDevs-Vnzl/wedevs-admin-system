"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { deallocatePaymentAction } from "@/features/payments/actions";
import type { PaymentAllocationResponseDto, PaymentResponseDto } from "@/lib/api/types/payments";
import { compareMoney, isDecimalString } from "@/lib/money";
import { AllocatePaymentSheet } from "./allocate-payment-sheet";
import { PaymentAllocationsTable } from "./payment-allocations-table";
import { useErrorText } from "./use-error-text";

type PaymentAllocationsPanelProps = {
  payment: PaymentResponseDto;
  /** Shows "Asignar" and "Desasignar" (cosmetic: the BE `can()` decides, PRD §4.3). */
  canUpdate?: boolean;
};

/**
 * "Asignaciones" of the payment detail (PRD §8.6): the invoices it is applied to, "Asignar" while a confirmed
 * payment has an unallocated rest (HU-13 CA5) and "Desasignar" per row, after a confirmation. Both refresh the page
 * from the BE; a voided payment shows no allocations.
 */
export function PaymentAllocationsPanel({
  payment,
  canUpdate = false,
}: PaymentAllocationsPanelProps) {
  const t = useTranslations("payments.detail");
  const tActions = useTranslations("common.actions");
  const router = useRouter();
  const errorText = useErrorText();
  const [allocating, setAllocating] = useState(false);
  const [target, setTarget] = useState<PaymentAllocationResponseDto | null>(null);
  const [pending, setPending] = useState(false);

  const hasRest =
    isDecimalString(payment.unallocated) && compareMoney(payment.unallocated, "0") > 0;
  const canAllocate = canUpdate && payment.status === "CONFIRMADO" && hasRest;
  const canDeallocate = canUpdate && payment.status !== "ANULADO";

  async function deallocate(allocation: PaymentAllocationResponseDto) {
    setPending(true);
    const result = await deallocatePaymentAction({ allocationId: allocation.id });
    setPending(false);
    setTarget(null);
    if (!result.ok) {
      toast.error(errorText(result.error));
      return;
    }
    toast.success(t("deallocate.done"));
    router.refresh();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle>{t("allocationsTitle")}</CardTitle>
          <CardDescription>{t("allocationsDescription")}</CardDescription>
        </div>
        {canAllocate ? (
          <Button
            className="transition-transform active:scale-[0.96]"
            onClick={() => setAllocating(true)}
          >
            {t("actions.allocate")}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        <PaymentAllocationsTable
          rows={payment.allocations}
          currency={payment.currency}
          {...(canDeallocate ? { onDeallocate: setTarget } : {})}
        />
      </CardContent>

      {canAllocate ? (
        <AllocatePaymentSheet
          payment={{
            id: payment.id,
            clientId: payment.client.id,
            currency: payment.currency,
            usdRate: payment.usdRate,
            unallocated: payment.unallocated,
          }}
          open={allocating}
          onOpenChange={setAllocating}
        />
      ) : null}

      <AlertDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deallocate.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deallocate.description", { invoice: target?.invoice.label ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{tActions("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={(event) => {
                event.preventDefault();
                if (target) void deallocate(target);
              }}
            >
              {t("deallocate.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
