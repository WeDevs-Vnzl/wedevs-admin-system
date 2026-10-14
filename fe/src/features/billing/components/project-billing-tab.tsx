import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FinancialSummaryCard } from "@/components/patterns/financial-summary-card";
import { MoneyText } from "@/components/patterns/money-text";
import { Button } from "@/components/ui/button";
import { getProjectFinancials } from "@/features/projects/queries";
import { compareMoney } from "@/lib/money";

/**
 * "Cobro" tab of the project detail (PRD §8.3, §8.4.4): the project's financial summary in USD and the way into
 * `/projects/[id]/billing`, where the plan, the installments and the recurring charges are managed.
 */
export async function ProjectBillingTab({ projectId }: { projectId: string }) {
  const t = await getTranslations("billing.summary");
  const summary = await getProjectFinancials(projectId);
  const usd = (amount: string) => <MoneyText amount={amount} currency="USD" />;

  return (
    <div className="flex flex-col items-start gap-4">
      <div className="w-full max-w-md">
        <FinancialSummaryCard
          title={t("title")}
          rows={[
            { label: t("contractedValue"), value: usd(summary.contractedValue) },
            { label: t("invoiced"), value: usd(summary.invoiced) },
            { label: t("collected"), value: usd(summary.collected) },
            ...(summary.toInvoice === null
              ? []
              : [{ label: t("toInvoice"), value: usd(summary.toInvoice) }]),
            { label: t("receivable"), value: usd(summary.receivable) },
            { label: t("monthlyRecurring"), value: usd(summary.monthlyRecurring) },
            { label: t("allocatedExpenses"), value: usd(summary.allocatedExpenses) },
          ]}
          total={{
            label: t("margin"),
            value: usd(summary.margin),
            danger: compareMoney(summary.margin, "0") < 0,
          }}
        />
      </div>
      <Button variant="outline" asChild>
        <Link href={`/projects/${projectId}/billing`}>{t("open")}</Link>
      </Button>
    </div>
  );
}
