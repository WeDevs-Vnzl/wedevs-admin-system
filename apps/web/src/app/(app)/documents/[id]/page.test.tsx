import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({
  readDocumentDetail: vi.fn(),
  listDocumentVersions: vi.fn(),
  getDocumentDetailPermissions: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("@/features/documents/queries", () => reads);
// The tabs and panels render elsewhere; the page only wires their inputs (cross-module boundaries are stubbed).
vi.mock("@/components/app/breadcrumb-label", () => ({ BreadcrumbLabel: () => null }));
vi.mock("@/features/activity/components/entity-activity-tab", () => ({
  EntityActivityTab: () => null,
}));
vi.mock("@/features/documents/components/document-detail-content", () => ({
  DocumentDetailContent: () => null,
}));
vi.mock("@/features/documents/components/document-detail-header", () => ({
  DocumentDetailHeader: () => null,
}));
vi.mock("@/features/documents/components/document-detail-links", () => ({
  DocumentDetailLinks: () => null,
}));
vi.mock("@/features/documents/components/document-detail-panel", () => ({
  DocumentDetailPanel: () => null,
}));
vi.mock("@/features/documents/components/document-detail-tabs", () => ({
  DocumentDetailTabs: () => null,
}));
vi.mock("@/features/documents/components/document-version-history", () => ({
  DocumentVersionHistory: () => null,
}));
vi.mock("@/features/documents/components/document-version-upload-dialog", () => ({
  DocumentVersionUploadDialog: () => null,
}));
vi.mock("@/features/notes/components/entity-notes-tab", () => ({ EntityNotesTab: () => null }));
vi.mock("@/features/shares/components/document-shares-tab", () => ({
  DocumentSharesTab: () => null,
}));

import { EntityActivityTab } from "@/features/activity/components/entity-activity-tab";
import { DocumentDetailTabs } from "@/features/documents/components/document-detail-tabs";
import { EntityNotesTab } from "@/features/notes/components/entity-notes-tab";
import { DocumentSharesTab } from "@/features/shares/components/document-shares-tab";
import { ServiceError } from "@/server/errors";
import DocumentDetailPage from "./page";

const params = Promise.resolve({ id: "doc_1" });
const document = {
  id: "doc_1",
  code: "DOC-0001",
  title: "Contrato Kairos",
  status: "BORRADOR",
  type: { defaultFormat: "ARCHIVO" },
  currentVersion: null,
  versionCount: 0,
  links: [],
  archivedAt: null,
};

/** Every element in the tree, props that hold elements (the tabs' slots) included. */
function elements(node: ReactNode, found: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node) elements(child, found);
  } else if (isValidElement(node)) {
    found.push(node);
    for (const value of Object.values(node.props as Record<string, unknown>)) {
      elements(value as ReactNode, found);
    }
  }
  return found;
}

beforeEach(() => {
  for (const mock of Object.values(reads)) mock.mockReset();
  reads.readDocumentDetail.mockResolvedValue(document);
  reads.listDocumentVersions.mockResolvedValue([]);
  reads.getDocumentDetailPermissions.mockResolvedValue({ canUpdate: true, canReadActivity: true });
});

describe("/documents/[id]", () => {
  it("answers the not-found page when the document is not there or not visible", async () => {
    reads.readDocumentDetail.mockResolvedValue(null);
    await expect(DocumentDetailPage({ params })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("rethrows a failure that is not a not-found", async () => {
    reads.readDocumentDetail.mockRejectedValue(new ServiceError("VALIDATION"));
    await expect(DocumentDetailPage({ params })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("keeps the shares, notes and activity mounts with their props", async () => {
    const tree = elements(await DocumentDetailPage({ params }));
    expect(tree.find((el) => el.type === DocumentDetailTabs)).toBeDefined();
    expect(tree.find((el) => el.type === DocumentSharesTab)?.props).toEqual({
      documentId: "doc_1",
    });
    expect(tree.find((el) => el.type === EntityNotesTab)?.props).toEqual({
      entity: { type: "DOCUMENT", id: "doc_1", code: "DOC-0001", label: "Contrato Kairos" },
    });
    expect(tree.find((el) => el.type === EntityActivityTab)?.props).toEqual({
      entity: { type: "DOCUMENT", id: "doc_1" },
    });
  });

  it("leaves the activity tab out for a role that cannot read the log", async () => {
    reads.getDocumentDetailPermissions.mockResolvedValue({
      canUpdate: false,
      canReadActivity: false,
    });
    const tree = elements(await DocumentDetailPage({ params }));
    expect(tree.find((el) => el.type === EntityActivityTab)).toBeUndefined();
  });
});
