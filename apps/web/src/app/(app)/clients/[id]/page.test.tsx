import { beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({
  getClient: vi.fn(),
  getClientFinancials: vi.fn(),
  listContacts: vi.fn(),
  listProjects: vi.fn(),
  canCreateTagsInline: vi.fn(),
  requireSessionUser: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("@/lib/auth/session", () => ({ requireSessionUser: reads.requireSessionUser }));
vi.mock("@/features/clients/queries", () => ({
  getClient: reads.getClient,
  getClientFinancials: reads.getClientFinancials,
}));
vi.mock("@/features/contacts/queries", () => ({ listContacts: reads.listContacts }));
vi.mock("@/features/projects/queries", () => ({ listProjects: reads.listProjects }));
vi.mock("@/features/tags/queries", () => ({ canCreateTagsInline: reads.canCreateTagsInline }));
// The tabs and panels render elsewhere; the page only wires their inputs.
vi.mock("@/components/app/breadcrumb-label", () => ({ BreadcrumbLabel: () => null }));
vi.mock("@/components/patterns/detail-tabs", () => ({ DetailTabs: () => null }));
vi.mock("@/features/activity/components/entity-activity-tab", () => ({
  EntityActivityTab: () => null,
}));
vi.mock("@/features/clients/components/client-detail-header", () => ({
  ClientDetailHeader: () => null,
}));
vi.mock("@/features/clients/components/client-projects-tab", () => ({
  ClientProjectsTab: () => null,
}));
vi.mock("@/features/clients/components/client-side-panel", () => ({ ClientSidePanel: () => null }));
vi.mock("@/features/clients/components/client-summary", () => ({ ClientSummary: () => null }));
vi.mock("@/features/contacts/components/contacts-table", () => ({ ContactsTable: () => null }));
vi.mock("@/features/documents/components/entity-documents-tab", () => ({
  EntityDocumentsTab: () => null,
}));
vi.mock("@/features/invoices/components/related-invoices-tab", () => ({
  RelatedInvoicesTab: () => null,
}));
vi.mock("@/features/notes/components/entity-notes-tab", () => ({ EntityNotesTab: () => null }));
vi.mock("@/features/payments/components/client-payments-tab", () => ({
  ClientPaymentsTab: () => null,
}));

import { ServiceError } from "@/lib/service-error";
import ClientDetailPage from "./page";

const client = {
  id: "cli_kairos",
  code: "CLI-0001",
  tradeName: "Kairos Studio",
  kind: "EMPRESA",
  country: "VE",
  status: "ACTIVO",
  tags: [],
  contacts: [],
  archivedAt: null as string | null,
};

const params = Promise.resolve({ id: "cli_kairos" });

function asRole(role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER") {
  reads.requireSessionUser.mockResolvedValue({ id: `usr_${role}`, role });
}

beforeEach(() => {
  for (const mock of Object.values(reads)) mock.mockReset();
  reads.canCreateTagsInline.mockResolvedValue(false);
  reads.listContacts.mockResolvedValue({ items: [], total: 0 });
  reads.listProjects.mockResolvedValue({ items: [], total: 4 });
  reads.getClientFinancials.mockResolvedValue({ projectCount: 4 });
});

describe("/clients/[id]", () => {
  it("answers the not-found page when the BE hides the client (404)", async () => {
    asRole("MEMBER");
    reads.getClient.mockRejectedValue(new ServiceError("NOT_FOUND"));

    await expect(ClientDetailPage({ params })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("answers the not-found page for an archived client and a role without the trash grant", async () => {
    asRole("MEMBER");
    reads.getClient.mockResolvedValue({ ...client, archivedAt: "2026-10-01T00:00:00.000Z" });

    await expect(ClientDetailPage({ params })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("shows an archived client to Owner and Admin", async () => {
    asRole("ADMIN");
    reads.getClient.mockResolvedValue({ ...client, archivedAt: "2026-10-01T00:00:00.000Z" });

    await expect(ClientDetailPage({ params })).resolves.toBeDefined();
  });

  it("reads the financial summary for a finance role only", async () => {
    asRole("OWNER");
    reads.getClient.mockResolvedValue(client);
    await ClientDetailPage({ params });
    expect(reads.getClientFinancials).toHaveBeenCalledWith("cli_kairos");

    reads.getClientFinancials.mockClear();
    asRole("MEMBER");
    await ClientDetailPage({ params });
    expect(reads.getClientFinancials).not.toHaveBeenCalled();
  });

  it("rethrows a failure that is not a NOT_FOUND", async () => {
    asRole("OWNER");
    reads.getClient.mockRejectedValue(new ServiceError("FORBIDDEN"));

    await expect(ClientDetailPage({ params })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
