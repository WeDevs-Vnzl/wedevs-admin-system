"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Ban, CheckCircle2, Repeat } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { DateText } from "@/components/patterns/date-text";
import { MoneyText } from "@/components/patterns/money-text";
import { PageHeader } from "@/components/patterns/page-header";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { voidExpenseAction } from "@/features/expenses/actions";
import type { ExpenseAccountOption } from "@/features/expenses/form-options";
import { MarkPaidDialog } from "@/features/expenses/components/mark-paid-dialog";
import type { ExpenseDetailDTO } from "@/lib/validators/expenses";

type ExpenseDetailProps = {
  expense: ExpenseDetailDTO;
  accounts: ExpenseAccountOption[];
  /** Business "today" (America/Caracas), computed on the server. */
  today: string;
  canUpdate: boolean;
};

/**
 * `/expenses/[id]` (PRD §8.8): the facts of an expense, its amounts in the expense currency, the account and the
 * USD snapshot. A pending expense can be marked as paid (CA2); an expense that is not voided can be voided.
 */
export function ExpenseDetail({ expense, accounts, today, canUpdate }: ExpenseDetailProps) {
  const t = useTranslations("expenses");
  const tEnums = useTranslations("enums");
  const tRoot = useTranslations();
  const tErrors = useTranslations("common.errors");
  const locale = useLocale();
  const router = useRouter();
  const [paying, setPaying] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [pending, setPending] = useState(false);

  const isPending = expense.status === "PENDIENTE";
  const isVoided = expense.status === "ANULADO";
  const categoryName = (ref: { name: string; nameEn: string | null }) =>
    locale === "en" && ref.nameEn ? ref.nameEn : ref.name;
  const category = expense.category.parent
    ? `${categoryName(expense.category.parent)} → ${categoryName(expense.category)}`
    : categoryName(expense.category);

  async function onVoid(reason: string | undefined) {
    setPending(true);
    const result = await voidExpenseAction({ id: expense.id, reason: reason || undefined });
    setPending(false);
    setVoiding(false);
    if (!result.ok) {
      toast.error(
        result.error.message ? tRoot(result.error.message as never) : tErrors(result.error.code),
      );
      return;
    }
    toast.success(t("toast.voided"));
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={expense.description}
        description={`${expense.code}${expense.vendor ? ` · ${expense.vendor}` : ""}`}
        actions={
          canUpdate && (isPending || !isVoided) ? (
            <div className="flex flex-wrap gap-2">
              {isPending ? (
                <Button onClick={() => setPaying(true)}>
                  <CheckCircle2 aria-hidden />
                  {t("page.markPaidAction")}
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => setVoiding(true)} disabled={pending}>
                <Ban aria-hidden />
                {t("page.voidAction")}
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge enumName="ExpenseStatus" value={expense.status} />
        {expense.overdue ? <Badge variant="destructive">{t("status.overdue")}</Badge> : null}
        {expense.recurring ? <Badge variant="outline">{t("status.recurring")}</Badge> : null}
      </div>

      <div className="grid gap-4 @lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>{t("detail.amountTitle")}</CardTitle>
            <CardDescription>{t("detail.amountDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            <MoneyText
              amount={expense.amount}
              currency={expense.currency}
              className="text-2xl font-semibold"
            />
            <MoneyText
              amount={expense.amountUsd}
              currency="USD"
              className="text-sm text-muted-foreground"
            />
            {expense.accountAmount ? (
              <p className="text-sm text-muted-foreground">
                {t("detail.fields.accountAmount")}: {expense.accountAmount}
              </p>
            ) : null}
          </CardContent>
        </Card>
        <Card className="@lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("detail.dataTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm @md:grid-cols-2">
            <DataItem label={t("detail.fields.date")} value={<DateText value={expense.date} />} />
            <DataItem
              label={t("detail.fields.dueDate")}
              value={expense.dueDate ? <DateText value={expense.dueDate} /> : "—"}
            />
            <DataItem label={t("detail.fields.category")} value={category} />
            <DataItem label={t("detail.fields.vendor")} value={expense.vendor ?? "—"} />
            <DataItem
              label={t("detail.fields.account")}
              value={expense.account ? <span>{expense.account.label}</span> : t("detail.noAccount")}
            />
            <DataItem
              label={t("detail.fields.project")}
              value={expense.project ? expense.project.label : t("detail.noProject")}
            />
            <DataItem
              label={t("detail.fields.paidAt")}
              value={expense.paidAt ? <DateText value={expense.paidAt} /> : "—"}
            />
            <DataItem
              label={t("detail.fields.usdRate")}
              value={
                expense.currency === "USD" ? "—" : `${expense.usdRate} ${expense.currency}/USD`
              }
            />
            <DataItem
              label={t("detail.fields.status")}
              value={tEnums(`ExpenseStatus.${expense.status}`)}
            />
            {expense.recurringExpense ? (
              <DataItem
                label={t("detail.fields.recurringOrigin")}
                value={
                  <Link
                    className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
                    href={`/expenses/recurring/${expense.recurringExpense.id}`}
                  >
                    <Repeat aria-hidden className="size-3.5" />
                    {expense.recurringExpense.label}
                  </Link>
                }
              />
            ) : null}
          </CardContent>
        </Card>
      </div>

      {isPending ? (
        <MarkPaidDialog
          expense={expense}
          accounts={accounts}
          today={today}
          open={paying}
          onOpenChange={setPaying}
        />
      ) : null}

      <ConfirmDialog
        variant="void"
        open={voiding}
        onOpenChange={(open) => {
          if (!open) setVoiding(false);
        }}
        requireReason
        description={t("detail.voidDescription")}
        pending={pending}
        onConfirm={(result) => void onVoid(result.reason)}
      />
    </div>
  );
}

function DataItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="break-words">{value}</span>
    </div>
  );
}
