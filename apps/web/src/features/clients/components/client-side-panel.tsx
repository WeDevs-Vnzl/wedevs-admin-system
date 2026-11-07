import { getTranslations } from "next-intl/server";
import { FinancialSummaryCard } from "@/components/patterns/financial-summary-card";
import { DateText } from "@/components/patterns/date-text";
import { MoneyText } from "@/components/patterns/money-text";
import { SidePanelCard } from "@/components/patterns/side-panel-card";
import { isZeroMoney } from "@/lib/money";
import type { ClientDetailDto, ClientSummaryResponseDto } from "@/lib/api/types/clients";

type ClientSidePanelProps = {
  client: ClientDetailDto;
  /** The summary the page read for finance roles; `null` hides the financial card. */
  financials: ClientSummaryResponseDto | null;
};

/**
 * Side panel of the client detail: the key data, and the financial card for finance roles (the same snapshot
 * sums as the "Resumen" metrics, C16). The page reads the summary once, for finance roles only.
 */
export async function ClientSidePanel({ client, financials }: ClientSidePanelProps) {
  const t = await getTranslations("clients.detail");
  const tEnums = await getTranslations("enums");
  const none = t("keyData.none");
  const rows: [string, string | null][] = [
    [t("keyData.kind"), tEnums(`ClientKind.${client.kind}`)],
    [t("keyData.legalName"), client.kind === "EMPRESA" ? client.legalName : null],
    [t("keyData.taxId"), client.taxId],
    [t("keyData.country"), client.country],
    [t("keyData.address"), client.address],
    [t("keyData.phone"), client.phone],
    [t("keyData.email"), client.email],
    [t("keyData.website"), client.website],
  ];

  return (
    <aside className="flex flex-col gap-6">
      <SidePanelCard title={t("keyData.title")}>
        <dl className="grid gap-3 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="grid gap-0.5">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-medium break-words">{value ?? none}</dd>
            </div>
          ))}
          <div className="grid gap-0.5">
            <dt className="text-muted-foreground">{t("keyData.activatedAt")}</dt>
            <dd className="font-medium">
              {client.activatedAt ? <DateText value={new Date(client.activatedAt)} /> : none}
            </dd>
          </div>
        </dl>
      </SidePanelCard>

      {financials ? (
        <FinancialSummaryCard
          rows={[
            {
              label: t("metrics.totalInvoiced"),
              value: <MoneyText amount={financials.totalInvoicedUsd} currency="USD" />,
            },
            {
              label: t("metrics.totalCollected"),
              value: <MoneyText amount={financials.totalCollectedUsd} currency="USD" />,
            },
            {
              label: t("metrics.overdue"),
              value: <MoneyText amount={financials.overdueUsd} currency="USD" />,
              danger: !isZeroMoney(financials.overdueUsd),
            },
          ]}
          total={{
            label: t("metrics.receivable"),
            value: <MoneyText amount={financials.receivableUsd} currency="USD" />,
          }}
        />
      ) : null}
    </aside>
  );
}
