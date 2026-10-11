import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { PlusIcon } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { OverviewTableToggle } from "@/components/patterns/overview-table-toggle";
import { Button } from "@/components/ui/button";
import { ProjectsTable } from "@/features/projects/components/projects-table";
import { projectFilterFromParams } from "@/features/projects/table-filter";
import { listProjects } from "@/features/projects/queries";
import { getTags } from "@/features/tags/queries";
import { listTechnologies } from "@/features/technologies/queries";
import { resolveTechnologyIcon } from "@/features/technologies/icons";
import { technologyLabel } from "@/features/technologies/label";
import { isLocale, type Locale } from "@/i18n/config";
import { requireSessionUser } from "@/server/auth/session";
import { can, canSeeFinancials } from "@/server/auth/permissions";

type ProjectsListPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("projects.page");
  return { title: t("title") };
}

// `/projects/list` (wireframe 4.4): the full table. Facets, search, sort and the URL state come from `?…`; the
// first render reads through the queries, later changes through `listProjectsAction`. Money columns only for
// finance roles (never rendered for others, so never exported).
export default async function ProjectsListPage({ searchParams }: ProjectsListPageProps) {
  const user = await requireSessionUser();
  const filter = projectFilterFromParams(await searchParams);
  const localeValue = await getLocale();
  const locale: Locale = isLocale(localeValue) ? localeValue : "es";
  const t = await getTranslations("projects.page");

  const [page, technologies, tags] = await Promise.all([
    listProjects(filter),
    listTechnologies({ pageSize: 100, sort: "name:asc" }),
    getTags({ pageSize: 100, sort: "name:asc" }),
  ]);
  // Brand icons resolve here, once for the whole catalogue: the client table takes plain data (see icons.ts).
  const icons = Object.fromEntries(
    technologies.items.map((tech) => [tech.id, resolveTechnologyIcon(tech.iconSlug)]),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        count={page.total}
        actions={
          <>
            <OverviewTableToggle current="table" overviewHref="/projects" tableHref="/projects/list" />
            {can(user, "create", "project") ? (
              <Button asChild>
                <Link href="/projects/new">
                  <PlusIcon aria-hidden />
                  {t("newAction")}
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <ProjectsTable
        initialRows={page.items}
        initialTotal={page.total}
        technologies={technologies.items.map((tech) => ({
          id: tech.id,
          label: technologyLabel(tech, locale),
        }))}
        tags={tags.items}
        icons={icons}
        showFinancials={canSeeFinancials(user)}
        canCreate={can(user, "create", "project")}
        canArchive={can(user, "delete", "project")}
        canTag={can(user, "update", "project")}
      />
    </div>
  );
}
