import { getTranslations } from "next-intl/server";
import { MoneyText } from "@/components/patterns/money-text";
import { SectionCard } from "@/components/patterns/section-card";
import { StatGrid } from "@/components/patterns/stat-grid";
import { Badge } from "@/components/ui/badge";
import type { ClientDetailDTO } from "@/lib/validators/clients";

type ClientSummaryProps = {
  client: Pick<ClientDetailDTO, "contacts" | "financials">;
  canSeeFinancials: boolean;
};

/**
 * "Resumen" tab (PRD §8.2): highlighted contacts (primary first) and the metrics. The USD metrics come from the
 * stored snapshots (PD-4, C16) and are rendered only for finance roles; everyone gets the project count.
 */
export async function ClientSummary({ client, canSeeFinancials }: ClientSummaryProps) {
  const t = await getTranslations("clients.detail");
  const highlighted = client.contacts.filter((contact) => contact.archivedAt === null).slice(0, 5);

  return (
    <div className="grid gap-6">
      <SectionCard heading title={t("summary.contacts")}>
        {highlighted.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("summary.noContacts")}</p>
        ) : (
          <ul className="divide-y">
            {highlighted.map((contact) => (
              <li
                key={contact.id}
                className="flex flex-wrap items-center justify-between gap-2 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{contact.fullName}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {[contact.position, contact.email, contact.phone].filter(Boolean).join(" · ")}
                  </p>
                </div>
                {contact.isPrimary ? (
                  <Badge variant="secondary">{t("summary.primaryBadge")}</Badge>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard heading title={t("summary.metrics")}>
        <StatGrid
          items={[
            ...(canSeeFinancials
              ? [
                  {
                    label: t("metrics.totalInvoiced"),
                    value: <MoneyText amount={client.financials.totalInvoicedUsd} currency="USD" />,
                  },
                  {
                    label: t("metrics.totalCollected"),
                    value: (
                      <MoneyText amount={client.financials.totalCollectedUsd} currency="USD" />
                    ),
                  },
                  {
                    label: t("metrics.receivable"),
                    value: <MoneyText amount={client.financials.receivableUsd} currency="USD" />,
                  },
                  {
                    label: t("metrics.creditBalance"),
                    value: <MoneyText amount={client.financials.creditBalanceUsd} currency="USD" />,
                  },
                ]
              : []),
            {
              label: t("metrics.projects"),
              value: client.financials.projectCount,
              hint: t("summary.projectsHint"),
            },
          ]}
        />
      </SectionCard>
    </div>
  );
}
