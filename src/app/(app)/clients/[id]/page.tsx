import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BreadcrumbLabel } from "@/components/app/breadcrumb-label";
import { DetailTabs, type DetailTab } from "@/components/patterns/detail-tabs";
import { FinanceTabSlot } from "@/components/patterns/finance-tab-slot";
import { EntityActivityTab } from "@/features/activity/components/entity-activity-tab";
import { ClientDetailHeader } from "@/features/clients/components/client-detail-header";
import { visibleClientDetailTabs } from "@/features/clients/components/client-detail-tabs";
import { clientScreenPermissions } from "@/features/clients/components/client-permissions";
import { canCreateTagsInline } from "@/features/tags/queries";
import { ClientProjectsTab } from "@/features/clients/components/client-projects-tab";
import { ClientSidePanel } from "@/features/clients/components/client-side-panel";
import { ClientSummary } from "@/features/clients/components/client-summary";
import { getClient } from "@/features/clients/queries";
import { ContactsTable } from "@/features/contacts/components/contacts-table";
import { listContacts } from "@/features/contacts/queries";
import { EntityDocumentsTab } from "@/features/documents/components/entity-documents-tab";
import { EntityNotesTab } from "@/features/notes/components/entity-notes-tab";
import { requireSessionUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { ServiceError } from "@/server/errors";
import type { EntityRef } from "@/lib/validators/common";
import type { ClientDetailDTO } from "@/lib/validators/clients";

type ClientDetailPageProps = {
  params: Promise<{ id: string }>;
};

/** The client, or `null` when it does not exist (or is archived for a role that may not open the trash). */
async function readClient(id: string): Promise<ClientDetailDTO | null> {
  try {
    return await getClient(id);
  } catch (error) {
    if (error instanceof ServiceError && error.code === "NOT_FOUND") return null;
    throw error;
  }
}

export async function generateMetadata({ params }: ClientDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations("clients.page");
  const client = await readClient(id);
  return {
    title: client ? t("detailTitle", { code: client.code, name: client.tradeName }) : t("title"),
  };
}

// `/clients/[id]` (PRD §7.2, §8.2): the header, the side panel and the tabs chosen by `?tab=` (DetailTabs).
// Unknown ids, and archived clients for roles without the trash grant, answer the not-found page.
export default async function ClientDetailPage({ params }: ClientDetailPageProps) {
  const { id } = await params;
  const user = await requireSessionUser();
  const permissions = clientScreenPermissions(user, await canCreateTagsInline());
  const client = await readClient(id);
  if (!client || (client.archivedAt && !permissions.canRestore)) notFound();

  const tabs = visibleClientDetailTabs({
    canSeeFinancials: permissions.canSeeFinancials,
    canReadActivity: permissions.canReadActivity,
  });
  const contacts = await listContacts({ clientId: client.id, pageSize: 100 });
  const ref: EntityRef = {
    type: "CLIENT",
    id: client.id,
    code: client.code,
    label: client.tradeName,
  };
  const t = await getTranslations("clients.detail.tabs");
  const available: Record<(typeof tabs)[number], DetailTab> = {
    summary: {
      value: "summary",
      label: t("summary"),
      content: <ClientSummary client={client} canSeeFinancials={permissions.canSeeFinancials} />,
    },
    contacts: {
      value: "contacts",
      label: t("contacts"),
      count: contacts.total,
      content: (
        <ContactsTable
          clientId={client.id}
          contacts={contacts.items}
          canManage={permissions.canManageContacts}
          canCreateTags={permissions.canCreateTags}
        />
      ),
    },
    projects: {
      value: "projects",
      label: t("projects"),
      count: client.financials.projectCount,
      content: (
        <ClientProjectsTab clientId={client.id} canCreate={can(user, "create", "project")} />
      ),
    },
    invoices: {
      value: "invoices",
      label: t("invoices"),
      content: <FinanceTabSlot kind="invoices" />,
    },
    payments: {
      value: "payments",
      label: t("payments"),
      content: <FinanceTabSlot kind="payments" />,
    },
    documents: {
      value: "documents",
      label: t("documents"),
      content: <EntityDocumentsTab entity={ref} />,
    },
    notes: { value: "notes", label: t("notes"), content: <EntityNotesTab entity={ref} /> },
    activity: {
      value: "activity",
      label: t("activity"),
      content: <EntityActivityTab entity={{ type: "CLIENT", id: client.id }} />,
    },
  };

  return (
    <div className="flex flex-col gap-6">
      <BreadcrumbLabel segment={client.id} label={`${client.code} · ${client.tradeName}`} />
      <ClientDetailHeader
        client={{
          id: client.id,
          code: client.code,
          tradeName: client.tradeName,
          kind: client.kind,
          country: client.country,
          status: client.status,
          tags: client.tags,
          archivedAt: client.archivedAt,
        }}
        permissions={permissions}
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <DetailTabs tabs={tabs.map((tab) => available[tab])} defaultTab="summary" />
        </div>
        <ClientSidePanel client={client} canSeeFinancials={permissions.canSeeFinancials} />
      </div>
    </div>
  );
}
