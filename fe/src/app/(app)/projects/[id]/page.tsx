import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BreadcrumbLabel } from "@/components/app/breadcrumb-label";
import { DetailTabs, type DetailTab } from "@/components/patterns/detail-tabs";
import { FinanceTabSlot } from "@/components/patterns/finance-tab-slot";
import { RichTextView } from "@/components/ui/rich-text";
import { EntityActivityTab } from "@/features/activity/components/entity-activity-tab";
import { canReadActivity } from "@/features/activity/queries";
import { EntityDocumentsTab } from "@/features/documents/components/entity-documents-tab";
import { EntityNotesTab } from "@/features/notes/components/entity-notes-tab";
import { DEFAULT_PROJECT_DETAIL_TAB, type ProjectDetailTab } from "@/features/projects/detail-tabs";
import { getProject } from "@/features/projects/queries";
import { loadProjectOr404 } from "@/features/projects/load-project";
import { ProjectDetailHeader } from "@/features/projects/components/project-detail-header";
import { ProjectLinksPanel } from "@/features/projects/components/project-links-panel";
import {
  ProjectClientsCard,
  ProjectDatesCard,
  ProjectFinancialCard,
  ProjectStackCard,
} from "@/features/projects/components/project-key-data";
import { requireSessionUser } from "@/server/auth/session";
import { can, canSeeFinancials } from "@/server/auth/permissions";
import type { EntityRef } from "@/lib/validators/common";

type ProjectPageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: ProjectPageProps): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations("projects");
  try {
    const project = await getProject(id);
    return { title: `${project.code} · ${project.name}` };
  } catch {
    return { title: t("page.title") };
  }
}

// `/projects/[id]` (PRD §8.3 detail, §8.2 tabs): Summary, Links, finance slots (finance roles), Documents,
// Notes and Activity (only when the user may read the activity log). `?tab=` selects the tab; its values are
// `PROJECT_DETAIL_TAB_VALUES`.
export default async function ProjectDetailPage({ params }: ProjectPageProps) {
  const { id } = await params;
  const user = await requireSessionUser();
  const project = await loadProjectOr404(id);
  const canEdit = can(user, "update", "project");
  const canArchive = can(user, "delete", "project");
  const showFinancials = canSeeFinancials(user);
  const showActivity = await canReadActivity();
  const tDetail = await getTranslations("projects.detail");
  const tTabs = await getTranslations("projects.detail.tabs");

  const ref: EntityRef = {
    type: "PROJECT",
    id: project.id,
    code: project.code,
    label: project.name,
  };

  const tabs: DetailTab[] = [
    {
      value: "summary" satisfies ProjectDetailTab,
      label: tTabs("summary"),
      content: (
        <div className="flex flex-col gap-4">
          <p className="text-sm">{project.summary}</p>
          {project.description ? (
            <RichTextView content={project.description} />
          ) : (
            <p className="text-sm text-muted-foreground">{tDetail("noDescription")}</p>
          )}
        </div>
      ),
    },
    {
      value: "links" satisfies ProjectDetailTab,
      label: tTabs("links"),
      count: project.links.length,
      content: (
        <ProjectLinksPanel projectId={project.id} links={project.links} canReorder={canEdit} />
      ),
    },
    ...(showFinancials
      ? [
          {
            value: "billing" satisfies ProjectDetailTab,
            label: tTabs("billing"),
            content: <FinanceTabSlot kind="billing" />,
          },
          {
            value: "invoices" satisfies ProjectDetailTab,
            label: tTabs("invoices"),
            content: <FinanceTabSlot kind="invoices" />,
          },
          {
            value: "expenses" satisfies ProjectDetailTab,
            label: tTabs("expenses"),
            content: <FinanceTabSlot kind="expenses" />,
          },
        ]
      : []),
    {
      value: "documents" satisfies ProjectDetailTab,
      label: tTabs("documents"),
      content: <EntityDocumentsTab entity={ref} />,
    },
    {
      value: "notes" satisfies ProjectDetailTab,
      label: tTabs("notes"),
      content: <EntityNotesTab entity={ref} />,
    },
    ...(showActivity
      ? [
          {
            value: "activity" satisfies ProjectDetailTab,
            label: tTabs("activity"),
            content: <EntityActivityTab entity={{ type: "PROJECT", id: project.id }} />,
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <BreadcrumbLabel segment={project.id} label={`${project.code} · ${project.name}`} />
      <ProjectDetailHeader
        id={project.id}
        code={project.code}
        name={project.name}
        status={project.status}
        startDate={project.startDate}
        endDate={project.endDate}
        archived={project.archivedAt !== null}
        tags={project.tags}
        canEdit={canEdit}
        canArchive={canArchive}
      />
      {/* Side panel: key data for every reader; the financial headline only for finance roles (PRD §11). */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <DetailTabs tabs={tabs} defaultTab={DEFAULT_PROJECT_DETAIL_TAB} />
        </div>
        <aside className="space-y-6">
          <ProjectClientsCard project={project} />
          <ProjectDatesCard project={project} />
          <ProjectStackCard project={project} />
          {showFinancials ? <ProjectFinancialCard project={project} /> : null}
        </aside>
      </div>
    </div>
  );
}
