import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/messages/en/common.json";
import enDocumentEditor from "@/i18n/messages/en/documentEditor.json";
import enDocuments from "@/i18n/messages/en/documents.json";
import enEnums from "@/i18n/messages/en/enums.json";
import type { DocumentDetailDTO } from "@/lib/validators/documents";

const actions = vi.hoisted(() => ({
  saveDocumentDraftAction: vi.fn(),
  publishDocumentVersionAction: vi.fn(),
}));
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));

vi.mock("../actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { DocumentEditor } from "./document-editor";

const messages = {
  common: enCommon,
  documentEditor: enDocumentEditor,
  documents: enDocuments,
  enums: enEnums,
};

const document = {
  id: "doc_0018",
  code: "DOC-0018",
  title: "PRD App Delivery",
  status: "BORRADOR",
  type: { id: "dtyp_prd", name: "PRD", nameEn: "PRD", defaultFormat: "MARKDOWN" },
  versionCount: 3,
  currentVersion: {
    id: "dver_3",
    versionNumber: 3,
    format: "MARKDOWN",
    content: "# Version three",
    isCurrent: true,
  },
  draftContent: null,
  draftUpdatedAt: null,
} as unknown as DocumentDetailDTO;

function renderEditor(
  availability: "editable" | "signed" | "notMarkdown" = "editable",
  overrides: Partial<DocumentDetailDTO> = {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <DocumentEditor
        document={{ ...document, ...overrides }}
        availability={availability}
        initialContent="# Version three"
      />
    </NextIntlClientProvider>,
  );
}

const source = () => screen.getByRole("textbox", { name: "Markdown source" });
const type = (value: string) => fireEvent.change(source(), { target: { value } });

beforeEach(() => {
  actions.saveDocumentDraftAction.mockReset();
  actions.publishDocumentVersionAction.mockReset();
  router.refresh.mockReset();
});

describe("DocumentEditor save", () => {
  const saveButton = () => screen.getByRole("button", { name: "Save draft" });

  beforeEach(() => {
    actions.saveDocumentDraftAction.mockResolvedValue({
      ok: true,
      data: { documentId: document.id, draftUpdatedAt: "2026-10-15T12:00:00.000Z" },
    });
  });

  it("never saves on its own while editing, however long the pause", async () => {
    vi.useFakeTimers();
    try {
      renderEditor();
      type("# Changed");
      await act(async () => {
        vi.advanceTimersByTime(60_000);
      });
      expect(actions.saveDocumentDraftAction).not.toHaveBeenCalled();
      expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");
    } finally {
      vi.useRealTimers();
    }
  });

  it("saves the latest text as the draft only when Save draft is pressed", async () => {
    const user = userEvent.setup();
    renderEditor();
    expect(saveButton()).toBeDisabled();
    type("# Changed");
    await user.click(saveButton());

    expect(actions.saveDocumentDraftAction).toHaveBeenCalledTimes(1);
    expect(actions.saveDocumentDraftAction).toHaveBeenCalledWith({
      documentId: document.id,
      content: "# Changed",
    });
    expect(actions.publishDocumentVersionAction).not.toHaveBeenCalled();
    expect(await screen.findByRole("status")).toHaveTextContent("Saved");
    expect(saveButton()).toBeDisabled();
  });

  it("shows an error state and keeps Save draft available when the draft cannot be saved", async () => {
    const user = userEvent.setup();
    actions.saveDocumentDraftAction.mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL", message: "common.errors.INTERNAL" },
    });
    renderEditor();
    type("# Changed");
    await user.click(saveButton());
    expect(await screen.findByRole("status")).toHaveTextContent("Draft not saved");
    expect(saveButton()).toBeEnabled();
  });

  it("locks the editor when the server reports the document signed", async () => {
    const user = userEvent.setup();
    actions.saveDocumentDraftAction.mockResolvedValue({
      ok: false,
      error: { code: "INTEGRITY_LOCK", message: "common.errors.INTEGRITY_LOCK" },
    });
    renderEditor();
    type("# Changed");
    await user.click(saveButton());
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Markdown source" })).toBeNull(),
    );
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
  });
});

describe("DocumentEditor preview", () => {
  it("renders the markdown source live in the preview", () => {
    renderEditor();
    type("# Live heading");
    const preview = screen.getByRole("region", { name: "Preview" });
    expect(within(preview).getByRole("heading", { name: "Live heading" })).toBeInTheDocument();
  });
});

describe("DocumentEditor publish", () => {
  it("publishes version N+1 with the change note and the latest content, then shows it as current", async () => {
    const user = userEvent.setup();
    actions.publishDocumentVersionAction.mockResolvedValue({
      ok: true,
      data: {
        ...document,
        versionCount: 4,
        draftContent: null,
        currentVersion: { ...document.currentVersion, versionNumber: 4, content: "# Four" },
      },
    });
    renderEditor();
    type("# Four");
    await user.click(screen.getByRole("button", { name: "Publish version v4" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Change note/), "Scope updated");
    await user.click(within(dialog).getByRole("button", { name: "Publish" }));

    await waitFor(() =>
      expect(actions.publishDocumentVersionAction).toHaveBeenCalledWith({
        documentId: document.id,
        content: "# Four",
        changelog: "Scope updated",
      }),
    );
    expect(await screen.findByText("Current: v4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish version v5" })).toBeInTheDocument();
    expect(router.refresh).toHaveBeenCalled();
  });

  it("switches to the locked state when the server reports the document signed", async () => {
    const user = userEvent.setup();
    actions.publishDocumentVersionAction.mockResolvedValue({
      ok: false,
      error: { code: "INTEGRITY_LOCK", message: "common.errors.INTEGRITY_LOCK" },
    });
    renderEditor();
    await user.click(screen.getByRole("button", { name: "Publish version v4" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Publish" }));
    expect(await screen.findByText("This document is signed")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Markdown source" })).not.toBeInTheDocument();
  });
});

describe("DocumentEditor locked and unsupported states", () => {
  it("shows a signed document read-only, with no editing and no publishing", () => {
    renderEditor("signed", { status: "FIRMADO" });
    expect(screen.getByText("This document is signed")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Markdown source" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Publish version/ })).not.toBeInTheDocument();
    const preview = screen.getByRole("region", { name: "Preview" });
    expect(within(preview).getByRole("heading", { name: "Version three" })).toBeInTheDocument();
  });

  it("explains that a file or link document has no markdown editor and links back to it", () => {
    renderEditor("notMarkdown");
    expect(screen.getByText("This document is not edited in markdown")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the document" })).toHaveAttribute(
      "href",
      "/documents/doc_0018",
    );
    expect(screen.queryByRole("textbox", { name: "Markdown source" })).not.toBeInTheDocument();
  });
});
