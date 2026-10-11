import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { DateText } from "@/components/patterns/date-text";
import { RelatedMiniTable } from "@/components/patterns/related-mini-table";
import { StatusBadge } from "@/components/patterns/status-badge";
import { listProjects } from "@/features/projects/queries";

/**
 * "Proyectos" tab (HU-05 CA3): the client's non-archived projects, with "+ Nuevo" pre-linking this client.
 * Read through the projects query, so the list is the same one the projects module shows.
 */
export async function ClientProjectsTab({ clientId }: { clientId: string }) {
  const t = await getTranslations("clients.detail.projects");
  const page = await listProjects({ clientId });

  return (
    <RelatedMiniTable
      title={t("title")}
      headers={[
        t("headers.code"),
        t("headers.name"),
        t("headers.status"),
        t("headers.targetEndDate"),
      ]}
      rows={page.items.map((project) => ({
        id: project.id,
        cells: [
          <span key="code" className="font-mono text-xs">
            {project.code}
          </span>,
          <Link key="name" href={`/projects/${project.id}`} className="font-medium hover:underline">
            <span className="sr-only">{t("openProject", { code: project.code })}: </span>
            {project.name}
          </Link>,
          <StatusBadge key="status" enumName="ProjectStatus" value={project.status} />,
          project.targetEndDate ? (
            <DateText key="target" value={project.targetEndDate} />
          ) : (
            <span key="target">—</span>
          ),
        ],
      }))}
      newHref={`/projects/new?clientId=${encodeURIComponent(clientId)}`}
    />
  );
}
