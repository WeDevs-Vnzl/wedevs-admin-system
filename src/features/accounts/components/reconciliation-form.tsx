"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { MoneyText } from "@/components/patterns/money-text";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field/date-field";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { reconcileAccountAction } from "@/features/accounts/actions";

/** What the reconciliation action answers (`ReconciliationPreview` of the service). */
type ReconciliationPreview = {
  systemBalance: string;
  difference: string;
  suggestedAdjustment: string | null;
};

type ReconciliationFormProps = {
  accountId: string;
  currency: string;
  /** Business "today" (America/Caracas), computed on the server. */
  today: string;
};

/**
 * Conciliation of one account (HU-15 CA3): the statement balance against the system balance at a date. A
 * difference suggests an `AJUSTE` for that amount; the adjustment is recorded through the movement form, which
 * stays the only writer of movements.
 */
export function ReconciliationForm({ accountId, currency, today }: ReconciliationFormProps) {
  const t = useTranslations("accounts");
  const tErrors = useTranslations("common.errors");
  const [date, setDate] = useState(today);
  const [statement, setStatement] = useState("");
  const [preview, setPreview] = useState<ReconciliationPreview | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const result = await reconcileAccountAction({ accountId, date, statementBalance: statement });
    setPending(false);
    if (!result.ok) {
      toast.error(tErrors(result.error.code));
      return;
    }
    setPreview(result.data);
  }

  const adjustmentHref = preview?.suggestedAdjustment
    ? `/accounts/movements/new?${new URLSearchParams({
        accountId,
        type: "AJUSTE",
        date,
        amount: preview.suggestedAdjustment,
      }).toString()}`
    : null;

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
      <div className="grid gap-4 @md:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="reconcile-date">{t("reconcile.date")}</FieldLabel>
          <DateField id="reconcile-date" value={date} max={today} onChange={setDate} />
        </Field>
        <Field>
          <FieldLabel htmlFor="reconcile-statement">{t("reconcile.statement")}</FieldLabel>
          <Input
            id="reconcile-statement"
            inputMode="decimal"
            placeholder="0.00"
            value={statement}
            onChange={(event) => setStatement(event.target.value)}
          />
        </Field>
      </div>
      <div>
        <Button type="submit" variant="outline" disabled={pending || statement.trim() === ""}>
          {t("reconcile.submit")}
        </Button>
      </div>

      {preview ? (
        <div className="grid gap-2 rounded-md border p-4 text-sm" aria-live="polite">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">{t("reconcile.system")}</span>
            <MoneyText amount={preview.systemBalance} currency={currency} />
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">{t("reconcile.difference")}</span>
            <MoneyText amount={preview.difference} currency={currency} />
          </div>
          {adjustmentHref ? (
            <div className="flex flex-col gap-2 pt-2">
              <p>{t("reconcile.suggestion")}</p>
              <Button asChild size="sm">
                <Link href={adjustmentHref}>{t("reconcile.adjust")}</Link>
              </Button>
            </div>
          ) : (
            <p className="pt-2 text-muted-foreground">{t("reconcile.noDifference")}</p>
          )}
        </div>
      ) : null}
    </form>
  );
}
