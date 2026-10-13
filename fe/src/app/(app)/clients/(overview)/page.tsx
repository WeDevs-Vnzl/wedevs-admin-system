import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ClientsOverview } from "@/features/clients/components/clients-overview";
import { clientScreenPermissions } from "@/features/clients/components/client-permissions";
import { canCreateTagsInline } from "@/features/tags/queries";
import { getClientsOverview } from "@/features/clients/queries";
import { requireSessionUser } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("clients.page");
  return { title: t("title") };
}

// `/clients` (PRD §8.2 "Overview"). Every role reads it; the money blocks and the finance alerts render for
// finance roles only (C13, R13: the booleans come from the server).
export default async function ClientsOverviewPage() {
  const user = await requireSessionUser();
  const permissions = clientScreenPermissions(user, await canCreateTagsInline());
  const overview = await getClientsOverview();

  return <ClientsOverview overview={overview} permissions={permissions} />;
}
