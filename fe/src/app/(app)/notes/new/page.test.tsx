import { beforeEach, describe, expect, it, vi } from "vitest";

const queries = vi.hoisted(() => ({
  getClient: vi.fn(),
  getProject: vi.fn(),
  getDocument: vi.fn(),
  getNotesViewer: vi.fn(),
  canCreateTagsInline: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("@/features/clients/queries", () => ({ getClient: queries.getClient }));
vi.mock("@/features/projects/queries", () => ({ getProject: queries.getProject }));
vi.mock("@/features/documents/queries", () => ({ getDocument: queries.getDocument }));
vi.mock("@/features/notes/queries", () => ({ getNotesViewer: queries.getNotesViewer }));
vi.mock("@/features/tags/queries", () => ({
  canCreateTagsInline: queries.canCreateTagsInline,
}));
vi.mock("@/features/notes/components/note-composer", () => ({ NoteComposerPage: () => null }));

import { ServiceError } from "@/server/context";
import NewNotePage from "./page";

function propsFor(entityType: string, entityId: string) {
  return { searchParams: Promise.resolve({ entityType, entityId }) };
}

async function initialLinksFor(entityType: string, entityId: string) {
  const element = await NewNotePage(propsFor(entityType, entityId));
  return (element.props as { initialLinks: unknown }).initialLinks;
}

beforeEach(() => {
  for (const mock of Object.values(queries)) mock.mockReset();
  queries.getNotesViewer.mockResolvedValue({ id: "usr_1", role: "MEMBER" });
  queries.canCreateTagsInline.mockResolvedValue(false);
});

describe("/notes/new prefill", () => {
  it("reads the prefilled document by its id and labels it with its title", async () => {
    queries.getDocument.mockResolvedValue({
      id: "doc_9",
      title: "Contrato marco",
      archivedAt: null,
    });
    expect(await initialLinksFor("DOCUMENT", "doc_9")).toEqual([
      { type: "DOCUMENT", id: "doc_9", label: "Contrato marco" },
    ]);
    expect(queries.getDocument).toHaveBeenCalledWith("doc_9");
  });

  it("leaves the note unlinked when the document is archived", async () => {
    queries.getDocument.mockResolvedValue({
      id: "doc_9",
      title: "Contrato marco",
      archivedAt: "2026-10-01T00:00:00.000Z",
    });
    expect(await initialLinksFor("DOCUMENT", "doc_9")).toEqual([]);
  });

  it("leaves the note unlinked when the document cannot be read", async () => {
    queries.getDocument.mockRejectedValue(new ServiceError("NOT_FOUND"));
    expect(await initialLinksFor("DOCUMENT", "doc_missing")).toEqual([]);
  });

  it("still prefills a client by its trade name", async () => {
    queries.getClient.mockResolvedValue({ id: "cli_1", tradeName: "Acme" });
    expect(await initialLinksFor("CLIENT", "cli_1")).toEqual([
      { type: "CLIENT", id: "cli_1", label: "Acme" },
    ]);
  });
});
