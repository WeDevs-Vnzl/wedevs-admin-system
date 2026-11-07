"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Ban, CheckCircle2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { DetailGraphToggle } from "@/components/patterns/detail-header";
import { PageHeader } from "@/components/patterns/page-header";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { setPaymentStatusAction } from "@/features/payments/actions";
import type { PaymentStatus } from "@/lib/validators/enums";
import { useErrorText } from "./use-error-text";

type PaymentDetailHeaderProps = {
  payment: {
    id: string;
    code: string;
    status: PaymentStatus;
    /** Client and method line, already localized by the page. */
    description: string;
  };
  /** Shows the status and edit actions (cosmetic: the BE `can()` decides, PRD §4.3). */
  canUpdate?: boolean;
};

/**
 * Header of `/payments/[id]`: code, client · method, status, the "Detalle | Grafo" toggle (A4) and, for roles with
 * the `payment` `update` grant, the status commands (DT-213): "Confirmar" (pending verification → confirmed; the BE
 * rechecks the limits), "Anular" with a required reason (the allocations disappear, shown from the response) and
 * "Editar" while the payment is not voided. Stripe-recorded payments (DT-183) are pending payments like any other.
 */
export function PaymentDetailHeader({ payment, canUpdate = false }: PaymentDetailHeaderProps) {
  const t = useTranslations("payments");
  const tActions = useTranslations("common.actions");
  const errorText = useErrorText();
  const router = useRouter();
  const [voiding, setVoiding] = useState(false);
  const [pending, setPending] = useState(false);
  const detailHref = `/payments/${encodeURIComponent(payment.id)}`;

  const isPendingVerification = payment.status === "PENDIENTE_VERIFICACION";
  const isVoided = payment.status === "ANULADO";
  const showActions = canUpdate && !isVoided;

  async function changeStatus(status: "CONFIRMADO" | "ANULADO", reason?: string) {
    setPending(true);
    const result = await setPaymentStatusAction({
      id: payment.id,
      status,
      ...(reason ? { reason } : {}),
    });
    setPending(false);
    setVoiding(false);
    if (!result.ok) {
      toast.error(errorText(result.error));
      return;
    }
    toast.success(t(status === "CONFIRMADO" ? "toast.confirmed" : "toast.voided"));
    router.refresh();
  }

  return (
    <>
      <PageHeader
        title={payment.code}
        description={payment.description}
        views={
          <DetailGraphToggle
            mode="detail"
            detailHref={detailHref}
            graphHref={`${detailHref}/graph`}
          />
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge enumName="PaymentStatus" value={payment.status} />
            {showActions ? (
              <>
                <Button variant="outline" asChild>
                  <Link href={`${detailHref}/edit`}>
                    <Pencil aria-hidden />
                    {tActions("edit")}
                  </Link>
                </Button>
                {isPendingVerification ? (
                  <Button
                    className="transition-transform active:scale-[0.96]"
                    disabled={pending}
                    onClick={() => void changeStatus("CONFIRMADO")}
                  >
                    <CheckCircle2 aria-hidden />
                    {t("detail.actions.confirm")}
                  </Button>
                ) : null}
                <Button variant="outline" disabled={pending} onClick={() => setVoiding(true)}>
                  <Ban aria-hidden />
                  {t("detail.actions.void")}
                </Button>
              </>
            ) : null}
          </div>
        }
      />
      <ConfirmDialog
        variant="void"
        open={voiding}
        onOpenChange={(open) => {
          if (!open) setVoiding(false);
        }}
        requireReason
        description={t("detail.voidDescription")}
        pending={pending}
        onConfirm={(result) => void changeStatus("ANULADO", result.reason)}
      />
    </>
  );
}
