import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BreadcrumbLabel } from "@/components/app/breadcrumb-label";
import { DateText } from "@/components/patterns/date-text";
import { MoneyText } from "@/components/patterns/money-text";
import { PageHeader } from "@/components/patterns/page-header";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RecurringExpenseForm } from "@/features/expenses/components/recurring-expense-form";
import { RecurringStatusActions } from "@/features/expenses/components/recurring-status-actions";
import { getExpenseFormOptions } from "@/features/expenses/form-options";
import { getRecurringExpense } from "@/features/expenses/queries";
import { expenseScreenPermissions } from "@/features/expenses/permissions";
import { todayInCaracas } from "@/lib/dates";
import type { RecurringExpenseDTO } from "@/lib/validators/expenses";
import { requireSessionUser } from "@/server/auth/session";
import { ServiceError } from "@/server/errors";

type RecurringExpenseDetailPageProps = {
  params: Promise<{ id: string }>;
};

async function readRecurring(id: string): Promise<RecurringExpenseDTO | null> {
  try {
    return await getRecurringExpense(id);
  } catch (error) {
    if (error instanceof ServiceError && error.code === "NOT_FOUND") return null;
    throw error;
  }
}

export async function generateMetadata({
  params,
}: RecurringExpenseDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations("expenses.page");
  const recurring = await readRecurring(id);
  return { title: recurring ? recurring.name : t("recurringTitle") };
}

// `/expenses/recurring/[id]` (HU-17): the schedule, its next period and its status, and the form to change it. A
// change of amount applies to the periods not generated yet.
export default async function RecurringExpenseDetailPage({
  params,
}: RecurringExpenseDetailPageProps) {
  const { id } = await params;
  const user = await requireSessionUser();
  const permissions = expenseScreenPermissions(user);
  if (!permissions.canRead) notFound();
  const recurring = await readRecurring(id);
  if (!recurring) notFound();
  const [options, t, tEnums] = await Promise.all([
    getExpenseFormOptions(),
    getTranslations("expenses"),
    getTranslations("enums"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <BreadcrumbLabel segment={recurring.id} label={recurring.name} />
      <PageHeader
        title={recurring.name}
        description={[tEnums(`Frequency.${recurring.frequency}`), recurring.vendor]
          .filter(Boolean)
          .join(" · ")}
        actions={
          permissions.canUpdate ? <RecurringStatusActions recurring={recurring} /> : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge enumName="RecurringStatus" value={recurring.status} />
      </div>

      <div className="grid gap-4 @lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>{t("recurring.detail.amountTitle")}</CardTitle>
            <CardDescription>{t("recurring.detail.amountDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            <MoneyText
              amount={recurring.amount}
              currency={recurring.currency}
              className="text-2xl font-semibold"
            />
            <span className="text-sm text-muted-foreground">
              {t("recurring.detail.nextDue")}:{" "}
              {recurring.nextDueDate ? <DateText value={recurring.nextDueDate} /> : "—"}
            </span>
            <span className="text-sm text-muted-foreground">
              {t("recurring.detail.lastGenerated")}:{" "}
              {recurring.lastGeneratedPeriodStart ? (
                <DateText value={recurring.lastGeneratedPeriodStart} />
              ) : (
                "—"
              )}
            </span>
          </CardContent>
        </Card>
        <Card className="@lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("recurring.detail.scheduleTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm @md:grid-cols-2">
            <DataItem
              label={t("recurring.detail.fields.category")}
              value={recurring.category.name}
            />
            <DataItem
              label={t("recurring.detail.fields.account")}
              value={recurring.account ? recurring.account.label : t("detail.noAccount")}
            />
            <DataItem
              label={t("recurring.detail.fields.dayOfPeriod")}
              value={String(recurring.dayOfPeriod)}
            />
            <DataItem
              label={t("recurring.detail.fields.leadDays")}
              value={String(recurring.leadDays)}
            />
            <DataItem label={t("recurring.detail.fields.startDate")} value={recurring.startDate} />
            <DataItem
              label={t("recurring.detail.fields.endDate")}
              value={recurring.endDate ?? "—"}
            />
          </CardContent>
        </Card>
      </div>

      {permissions.canUpdate ? (
        <RecurringExpenseForm
          options={options}
          today={todayInCaracas(new Date())}
          recurring={recurring}
        />
      ) : null}
    </div>
  );
}

function DataItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="break-words">{value}</span>
    </div>
  );
}
