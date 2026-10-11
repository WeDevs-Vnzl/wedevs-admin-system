import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ProjectForm } from "@/features/projects/components/project-form";
import { listActiveTechnologies } from "@/features/technologies/queries";
import { getClient } from "@/features/clients/queries";
import { canManageTags } from "@/features/tags/queries";
import type { EntityRef } from "@/lib/validators/common";
import { requireSessionUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";

type NewProjectPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("projects.form");
  return { title: t("createTitle") };
}

/** `?clientId=` prefills the first client (HU-05 CA3). An unknown or archived client is ignored, not an error. */
async function clientPrefill(value: string | string[] | undefined): Promise<EntityRef | null> {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id) return null;
  try {
    const client = await getClient(id);
    return { type: "CLIENT", id: client.id, code: client.code, label: client.tradeName };
  } catch {
    return null;
  }
}

// `/projects/new`: Owner, Admin. Member and Viewer get the in-shell not-found page (create is not granted to them).
export default async function NewProjectPage({ searchParams }: NewProjectPageProps) {
  const user = await requireSessionUser();
  if (!can(user, "create", "project")) notFound();
  const params = await searchParams;
  const [initialClient, technologies, canCreateTags] = await Promise.all([
    clientPrefill(params.clientId),
    listActiveTechnologies(),
    canManageTags(),
  ]);

  return (
    <ProjectForm
      mode="create"
      initialClient={initialClient}
      technologies={technologies}
      canCreateTags={canCreateTags}
      backHref="/projects/list"
    />
  );
}
