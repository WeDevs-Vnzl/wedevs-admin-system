import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { MoneyText } from "@/components/patterns/money-text";
import { FinancialSummaryCard } from "@/components/patterns/financial-summary-card";
import { SidePanelCard } from "@/components/patterns/side-panel-card";
import { TechStackIcons } from "@/features/technologies/components/tech-stack-icons";
import { stackChips } from "../stack-chips";
import { formatDate } from "@/lib/dates";
import { entityHref } from "@/lib/entity-routes";
import type { ProjectDetailDto } from "@/lib/api/types/projects";

// Server components only: the stack icons resolve on the server (`TechStackIcons`). Shared by the side panel
// and the *Resumen* tab (PRD §8.3), so the same key data reads the same in both places.

/** Clients with their roles, linked to their records. */
export async function ProjectClientsCard({ project }: { project: ProjectDetailDto }) {
  const t = await getTranslations("projects.detail");
  return (
    <SidePanelCard title={t("clientsTitle")}>
      {project.clients.length === 0 ? (
        <p className="text-muted-foreground">{t("noClients")}</p>
      ) : (
        <ul className="space-y-2">
          {project.clients.map(({ client, role }) => {
            const href = entityHref({ type: "CLIENT", id: client.id });
            return (
              <li key={client.id} className="flex flex-wrap items-center gap-2">
                {href ? (
                  <Link href={href} className="font-medium hover:underline">
                    {client.label}
                  </Link>
                ) : (
                  <span className="font-medium">{client.label}</span>
                )}
                {role ? <span className="text-muted-foreground">({role})</span> : null}
              </li>
            );
          })}
        </ul>
      )}
    </SidePanelCard>
  );
}

/** Start, estimated and actual delivery dates. */
export async function ProjectDatesCard({ project }: { project: ProjectDetailDto }) {
  const t = await getTranslations("projects.detail");
  const locale = await getLocale();
  const row = (label: string, value: string | null) => (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value ? formatDate(value, locale) : t("notSet")}</span>
    </div>
  );
  return (
    <SidePanelCard title={t("datesTitle")}>
      {row(t("startDate"), project.startDate)}
      {row(t("targetEndDate"), project.targetEndDate)}
      {row(t("endDate"), project.endDate)}
    </SidePanelCard>
  );
}

/** The stack as icons, names in tooltips. */
export async function ProjectStackCard({ project }: { project: ProjectDetailDto }) {
  const t = await getTranslations("projects.detail");
  const locale = await getLocale();
  return (
    <SidePanelCard title={t("stackTitle")}>
      {project.stack.length === 0 ? (
        <p className="text-muted-foreground">{t("noStack")}</p>
      ) : (
        <TechStackIcons
          technologies={stackChips(project.stack)}
          locale={locale === "en" ? "en" : "es"}
        />
      )}
    </SidePanelCard>
  );
}

/** Dark financial headline (finance roles only, PRD §11). USD decimal strings, never recomputed here (C15). */
export async function ProjectFinancialCard({ project }: { project: ProjectDetailDto }) {
  const t = await getTranslations("projects.detail");
  // `null` = no finance grant (C13): "—" instead of an amount.
  const usd = (amount: string | null) =>
    amount === null ? "—" : <MoneyText amount={amount} currency="USD" />;
  return (
    <FinancialSummaryCard
      title={t("financialTitle")}
      rows={[
        {
          label: t("financeContracted"),
          value: usd(project.contractedValueUsd),
        },
        {
          label: t("financeInvoiced"),
          value: usd(project.invoicedUsd),
        },
        {
          label: t("financeCollected"),
          value: usd(project.collectedUsd),
        },
      ]}
      total={{
        label: t("financeToInvoice"),
        value: usd(project.toInvoiceUsd),
      }}
    />
  );
}
