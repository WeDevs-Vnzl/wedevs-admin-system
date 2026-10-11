import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ProjectForm } from "@/features/projects/components/project-form";
import { loadProjectOr404 } from "@/features/projects/load-project";
import { getProject } from "@/features/projects/queries";
import { listActiveTechnologies } from "@/features/technologies/queries";
import { canManageTags } from "@/features/tags/queries";
import { requireSessionUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";

type EditProjectPageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: EditProjectPageProps): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations("projects.form");
  try {
    const project = await getProject(id);
    return { title: `${t("editTitle")} · ${project.name}` };
  } catch {
    return { title: t("editTitle") };
  }
}

// `/projects/[id]/edit`: Owner, Admin and Member (update). Viewer gets the in-shell not-found page. Status is
// not edited here (the transition dialog owns it, HU-08).
export default async function EditProjectPage({ params }: EditProjectPageProps) {
  const { id } = await params;
  const user = await requireSessionUser();
  if (!can(user, "update", "project")) notFound();
  const [project, technologies, canCreateTags] = await Promise.all([
    loadProjectOr404(id),
    listActiveTechnologies(),
    canManageTags(),
  ]);

  return (
    <ProjectForm
      mode="edit"
      project={project}
      technologies={technologies}
      canCreateTags={canCreateTags}
      backHref={`/projects/${project.id}`}
    />
  );
}
