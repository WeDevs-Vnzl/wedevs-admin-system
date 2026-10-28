import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/patterns/page-header";
import { GlobalGraph } from "@/features/graph/components/global-graph";
import { getGlobalGraph } from "@/features/graph/queries";
import { getTags } from "@/features/tags/queries";
import { listActiveTechnologies } from "@/features/technologies/queries";
import { can } from "@/server/auth/permissions";
import { requireSessionUser } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("graph.page");
  return { title: t("globalTitle") };
}

// `/graph` (PRD §8.12.4, HU-25): the global graph, clients, projects and documents with the force layout by default.
export default async function GlobalGraphPage() {
  const user = await requireSessionUser();
  const [t, graph, tags, technologies] = await Promise.all([
    getTranslations("graph.page"),
    getGlobalGraph(),
    getTags({ pageSize: 100 }),
    listActiveTechnologies(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("globalTitle")} description={t("globalDescription")} />
      <GlobalGraph
        initial={graph}
        canSeeArchived={can(user, "restore", "trash")}
        tags={tags.items.map((tag) => ({ id: tag.id, name: tag.name }))}
        technologies={technologies.map((tech) => ({ id: tech.id, name: tech.name }))}
      />
    </div>
  );
}
