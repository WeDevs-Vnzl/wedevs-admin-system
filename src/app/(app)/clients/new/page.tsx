import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ClientForm } from "@/features/clients/components/client-form";
import { clientScreenPermissions } from "@/features/clients/components/client-permissions";
import { canCreateTagsInline } from "@/features/tags/queries";
import { requireSessionUser } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("clients.page");
  return { title: t("newTitle") };
}

// `/clients/new` (HU-03 CA1). Only roles that may create a client get the form; the others get the not-found page.
export default async function NewClientPage() {
  const user = await requireSessionUser();
  const permissions = clientScreenPermissions(user, await canCreateTagsInline());
  if (!permissions.canCreate) notFound();

  return <ClientForm canCreateTags={permissions.canCreateTags} />;
}
