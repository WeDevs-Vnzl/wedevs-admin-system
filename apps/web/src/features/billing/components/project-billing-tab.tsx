import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { MoneyText } from "@/components/patterns/money-text";
import { SectionCard } from "@/components/patterns/section-card";
import { Button } from "@/components/ui/button";
import { getProjectFinancials } from "@/features/projects/queries";
import { compareMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * "Cobro" tab of the project detail (PRD §8.3, §8.4.4): the project's financial summary in USD and the way into
 * `/projects/[id]/billing`, where the plan, the installments and the recurring charges are managed.
 */
export async function ProjectBillingTab({ projectId }: { projectId: string }) {
  const t = await getTranslations("billing.summary");
  const summary = await getProjectFinancials(projectId);
  const usd = (amount: string) => <MoneyText amount={amount} currency="USD" />;

  const rows = [
    { label: t("contractedValue"), amount: summary.contractedValue },
    { label: t("invoiced"), amount: summary.invoiced },
    { label: t("collected"), amount: summary.collected },
    ...(summary.toInvoice === null ? [] : [{ label: t("toInvoice"), amount: summary.toInvoice }]),
    { label: t("receivable"), amount: summary.receivable },
    { label: t("monthlyRecurring"), amount: summary.monthlyRecurring },
    { label: t("allocatedExpenses"), amount: summary.allocatedExpenses },
  ];
  const negativeMargin = compareMoney(summary.margin, "0") < 0;

  return (
    <SectionCard
      heading
      title={t("title")}
      actions={
        <Button variant="outline" size="sm" asChild>
          <Link href={`/projects/${projectId}/billing`}>{t("open")}</Link>
        </Button>
      }
    >
      <dl className="flex flex-col divide-y text-sm">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-4 py-2">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="tabular-nums">{usd(row.amount)}</dd>
          </div>
        ))}
        <div className="flex items-center justify-between gap-4 py-2 font-semibold">
          <dt>{t("margin")}</dt>
          <dd className={cn("tabular-nums", negativeMargin && "text-destructive")}>
            {usd(summary.margin)}
          </dd>
        </div>
      </dl>
    </SectionCard>
  );
}
