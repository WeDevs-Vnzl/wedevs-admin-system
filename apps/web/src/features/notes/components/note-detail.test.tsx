import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  archiveNoteAction: vi.fn(),
  attachFileAction: vi.fn(),
  createNoteAction: vi.fn(),
  linkNoteAction: vi.fn(),
  pinNoteAction: vi.fn(),
  unlinkNoteAction: vi.fn(),
  updateNoteAction: vi.fn(),
}));
const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }));

vi.mock("@/features/notes/actions", () => actions);
vi.mock("@/features/clients/actions", () => ({ searchClientsAction: vi.fn() }));
vi.mock("@/features/contacts/actions", () => ({ searchContactsAction: vi.fn() }));
vi.mock("@/features/projects/actions", () => ({ searchProjectsAction: vi.fn() }));
vi.mock("@/features/documents/actions", () => ({ searchDocumentsAction: vi.fn() }));
vi.mock("@/features/invoices/actions", () => ({ searchInvoicesAction: vi.fn() }));
vi.mock("@/features/payments/actions", () => ({ searchPaymentsAction: vi.fn() }));
vi.mock("@/features/expenses/actions", () => ({ searchExpensesAction: vi.fn() }));
vi.mock("@/features/tags/components/tag-picker", () => ({ TagPicker: () => null }));
vi.mock("@/features/files/upload-adapter", () => ({ uploadAdapter: {} }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push, refresh: nav.refresh }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import enCommon from "@/i18n/messages/en/common.json";
import enEnums from "@/i18n/messages/en/enums.json";
import enForms from "@/i18n/messages/en/forms.json";
import enNotes from "@/i18n/messages/en/notes.json";
import enPatterns from "@/i18n/messages/en/patterns.json";
import enValidation from "@/i18n/messages/en/validation.json";
import type { NoteDetailDTO } from "@/lib/validators/notes";
import { NoteDetail } from "./note-detail";

const messages = {
  common: enCommon,
  enums: enEnums,
  forms: enForms,
  notes: enNotes,
  patterns: enPatterns,
  validation: enValidation,
};

const note: NoteDetailDTO = {
  id: "not_kickoff",
  title: "Kickoff",
  content: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Acta" }] }],
  },
  contentText: "Acta",
  author: { id: "usr_andres_molina", name: "Andrés Molina", imageUrl: null },
  pinned: false,
  tags: [],
  links: [{ id: "cli_kairos", label: "Kairos Studio", type: "CLIENT", code: "CLI-0001" }],
  attachments: [],
  createdAt: "2026-09-01T15:00:00.000Z",
  updatedAt: "2026-09-01T15:00:00.000Z",
  archivedAt: null,
};

function renderDetail(overrides: Partial<Parameters<typeof NoteDetail>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <NoteDetail note={note} canUpdate canArchive canCreateTags={false} {...overrides} />
    </NextIntlClientProvider>,
  );
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("NoteDetail", () => {
  it("shows the service's last-link guard message when the only link is removed", async () => {
    actions.unlinkNoteAction.mockResolvedValue({
      ok: false,
      error: { code: "INTEGRITY_LOCK", message: "notes.errors.lastLink" },
    });
    renderDetail();

    await userEvent.click(screen.getByRole("button", { name: "Remove Kairos Studio" }));

    expect(actions.unlinkNoteAction).toHaveBeenCalledWith({
      noteId: "not_kickoff",
      target: { entityType: "CLIENT", entityId: "cli_kairos" },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A note must stay linked to at least one record.",
    );
  });

  it("shows a Viewer the note without any link or edit control", () => {
    renderDetail({ canUpdate: false, canArchive: false });
    expect(screen.queryByRole("button", { name: "Remove Kairos Studio" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
    expect(screen.getByText("Kairos Studio")).toBeInTheDocument();
  });

  it("returns focus to the Archive button when the confirmation is cancelled (m1)", async () => {
    renderDetail();
    const opener = screen.getByRole("button", { name: "Archive" });
    opener.focus();
    await userEvent.click(opener);
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /cancel/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Archive" })).toHaveFocus());
  });
});
