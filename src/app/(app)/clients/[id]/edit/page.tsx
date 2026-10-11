import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BreadcrumbLabel } from "@/components/app/breadcrumb-label";
import { ClientForm } from "@/features/clients/components/client-form";
import { clientScreenPermissions } from "@/features/clients/components/client-permissions";
import { getClient } from "@/features/clients/queries";
import { requireSessionUser } from "@/server/auth/session";
import { ServiceError } from "@/server/errors";
import type { ClientDetailDTO } from "@/lib/validators/clients";

type ClientEditPageProps = {
  params: Promise<{ id: string }>;
};

async function readClient(id: string): Promise<ClientDetailDTO | null> {
  try {
    return await getClient(id);
  } catch (error) {
    if (error instanceof ServiceError && error.code === "NOT_FOUND") return null;
    throw error;
  }
}

export async function generateMetadata({ params }: ClientEditPageProps): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations("clients.page");
  const client = await readClient(id);
  return { title: client ? t("editTitle", { name: client.tradeName }) : t("title") };
}

// `/clients/[id]/edit` (HU-03). Roles that may not update clients, unknown ids and archived clients get the
// not-found page: an archived client is changed only after it is restored.
export default async function ClientEditPage({ params }: ClientEditPageProps) {
  const { id } = await params;
  const user = await requireSessionUser();
  const permissions = clientScreenPermissions(user);
  if (!permissions.canUpdate) notFound();
  const client = await readClient(id);
  if (!client || client.archivedAt) notFound();

  return (
    <>
      <BreadcrumbLabel segment={client.id} label={`${client.code} · ${client.tradeName}`} />
      <ClientForm client={client} canCreateTags={permissions.canCreateTags} />
    </>
  );
}
