"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CircleStop, Pause, Play } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { Button } from "@/components/ui/button";
import { setRecurringExpenseStatusAction } from "@/features/expenses/actions";
import type { RecurringExpenseDTO } from "@/lib/validators/expenses";

type RecurringStatusActionsProps = {
  recurring: RecurringExpenseDTO;
};

/**
 * Pauses, resumes or finishes a schedule (HU-17 CA3: a paused schedule generates nothing). Finishing is final and
 * asks for confirmation first.
 */
export function RecurringStatusActions({ recurring }: RecurringStatusActionsProps) {
  const t = useTranslations("expenses");
  const tRoot = useTranslations();
  const tErrors = useTranslations("common.errors");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [finishing, setFinishing] = useState(false);

  if (recurring.status === "FINALIZADO") {
    return <p className="text-sm text-muted-foreground">{t("recurring.detail.finishedNote")}</p>;
  }

  async function setStatus(status: "ACTIVO" | "PAUSADO" | "FINALIZADO") {
    setPending(true);
    const result = await setRecurringExpenseStatusAction({ id: recurring.id, status });
    setPending(false);
    setFinishing(false);
    if (!result.ok) {
      toast.error(
        result.error.message ? tRoot(result.error.message as never) : tErrors(result.error.code),
      );
      return;
    }
    toast.success(t("toast.recurringStatusChanged"));
    router.refresh();
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {recurring.status === "ACTIVO" ? (
          <Button variant="outline" disabled={pending} onClick={() => void setStatus("PAUSADO")}>
            <Pause aria-hidden />
            {t("recurring.detail.pause")}
          </Button>
        ) : (
          <Button variant="outline" disabled={pending} onClick={() => void setStatus("ACTIVO")}>
            <Play aria-hidden />
            {t("recurring.detail.resume")}
          </Button>
        )}
        <Button variant="outline" disabled={pending} onClick={() => setFinishing(true)}>
          <CircleStop aria-hidden />
          {t("recurring.detail.finish")}
        </Button>
      </div>
      <ConfirmDialog
        variant="cancel"
        open={finishing}
        onOpenChange={(open) => {
          if (!open) setFinishing(false);
        }}
        description={t("recurring.detail.finishDescription", { name: recurring.name })}
        pending={pending}
        onConfirm={() => void setStatus("FINALIZADO")}
      />
    </>
  );
}
