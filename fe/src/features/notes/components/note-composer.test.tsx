import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

const actions = vi.hoisted(() => ({
  attachFileAction: vi.fn(),
  createNoteAction: vi.fn(),
  pinNoteAction: vi.fn(),
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
vi.mock("@/features/files/upload-adapter", () => ({ uploadAdapter: {} }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push, refresh: nav.refresh }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// The tag picker is replaced by a button that picks one known tag: the test covers what the composer sends.
vi.mock("@/features/tags/components/tag-picker", () => ({
  TagPicker: ({
    onChange,
  }: {
    onChange: (tags: { id: string; name: string; color: string }[]) => void;
  }) => (
    <button
      type="button"
      onClick={() => onChange([{ id: "tag_vip", name: "VIP", color: "#ff0000" }])}
    >
      pick tag
    </button>
  ),
}));

// The editor is replaced by two buttons: one reports a valid document, one reports a refused one.
vi.mock("@/components/ui/rich-text", () => ({
  EMPTY_RICH_TEXT: { type: "doc", content: [{ type: "paragraph" }] },
  RichTextEditor: ({
    onChange,
    onInvalid,
  }: {
    onChange?: (doc: unknown) => void;
    onInvalid?: () => void;
  }) => (
    <div>
      <button
        type="button"
        onClick={() =>
          onChange?.({
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: "Hola" }] }],
          })
        }
      >
        write valid
      </button>
      <button type="button" onClick={() => onInvalid?.()}>
        refuse content
      </button>
    </div>
  ),
}));

import enCommon from "@/i18n/messages/en/common.json";
import enForms from "@/i18n/messages/en/forms.json";
import enNotes from "@/i18n/messages/en/notes.json";
import enPatterns from "@/i18n/messages/en/patterns.json";
import enValidation from "@/i18n/messages/en/validation.json";
import enEnums from "@/i18n/messages/en/enums.json";
import enTags from "@/i18n/messages/en/tags.json";
import type { NoteDetailDTO } from "@/lib/validators/notes";
import type { NoteLinkRef } from "./note-link-picker";
import { NoteComposerPage } from "./note-composer";

const messages = {
  common: enCommon,
  enums: enEnums,
  forms: enForms,
  notes: enNotes,
  patterns: enPatterns,
  tags: enTags,
  validation: enValidation,
};

const prefilled: NoteLinkRef[] = [{ type: "CLIENT", id: "cli_kairos", label: "Kairos Studio" }];

function renderPage(initialLinks: NoteLinkRef[] = prefilled) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <NoteComposerPage initialLinks={initialLinks} canCreateTags />
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
  actions.createNoteAction.mockResolvedValue({
    ok: true,
    data: { id: "not_new", links: [], tags: [], attachments: [] },
  });
});

describe("NoteComposerPage", () => {
  it("lays the new note out as a form page: title, back link and named sections", () => {
    renderPage();

    expect(screen.getByRole("heading", { level: 1, name: "New note" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/notes");
    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/notes");
    expect(screen.getByRole("group", { name: "Note" })).toHaveClass("md:col-span-2");
    expect(screen.getByRole("group", { name: "Where it appears" })).not.toHaveClass("md:col-span-2");
    expect(screen.getByRole("group", { name: "Organization" })).not.toHaveClass("md:col-span-2");
  });

  it("explains the optional title and the tags with hints tied to their fields", () => {
    renderPage();

    expect(screen.getByRole("textbox", { name: "Title" })).toHaveAccessibleDescription(
      "When empty, the first words of the content are used.",
    );
    expect(screen.getByText("Group notes so you can filter them in the list.")).toBeInTheDocument();
  });

  it("prefills the link of the record it was opened for", () => {
    renderPage();
    expect(screen.getByRole("button", { name: "Remove Kairos Studio" })).toBeInTheDocument();
    expect(screen.getByText("Kairos Studio")).toBeInTheDocument();
  });

  it("sends the tags picked on create with the note and opens the new note", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "write valid" }));
    await userEvent.click(screen.getByRole("button", { name: "pick tag" }));
    await userEvent.click(screen.getByRole("button", { name: "Save note" }));

    await waitFor(() =>
      expect(actions.createNoteAction).toHaveBeenCalledWith(
        expect.objectContaining({
          tagIds: ["tag_vip"],
          links: [{ entityType: "CLIENT", entityId: "cli_kairos" }],
        }),
      ),
    );
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/notes/not_new"));
  });

  it("blocks the save while the editor refuses its content, with an error the field points to", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "write valid" }));
    await userEvent.click(screen.getByRole("button", { name: "refuse content" }));
    await userEvent.click(screen.getByRole("button", { name: "Save note" }));

    expect(
      await screen.findByText("The content is not valid or is too long to save."),
    ).toBeInTheDocument();
    expect(actions.createNoteAction).not.toHaveBeenCalled();
  });
});

const kickoff: NoteDetailDTO = {
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

describe("NoteComposerPage edit", () => {
  beforeEach(() => {
    actions.updateNoteAction.mockResolvedValue({ ok: true, data: kickoff });
    actions.pinNoteAction.mockResolvedValue({ ok: true, data: { ...kickoff, pinned: true } });
  });

  it("stays a plain form inside the detail page, with no page title or sections of its own", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <NoteComposerPage note={kickoff} canCreateTags />
      </NextIntlClientProvider>,
    );

    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Note" })).not.toBeInTheDocument();
  });

  it("sends a cleared title as null, so the note loses its title (F6)", async () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <NoteComposerPage note={kickoff} canCreateTags />
      </NextIntlClientProvider>,
    );
    await userEvent.clear(screen.getByRole("textbox", { name: "Title" }));
    await userEvent.click(screen.getByRole("button", { name: "Save note" }));

    await waitFor(() =>
      expect(actions.updateNoteAction).toHaveBeenCalledWith({
        id: "not_kickoff",
        title: null,
        content: kickoff.content,
        tagIds: [],
      }),
    );
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it("shows the error and no success toast when the pin fails (nit)", async () => {
    actions.pinNoteAction.mockResolvedValue({ ok: false, error: { code: "INTERNAL" } });
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <NoteComposerPage note={kickoff} canCreateTags />
      </NextIntlClientProvider>,
    );
    await userEvent.click(screen.getByRole("switch"));
    await userEvent.click(screen.getByRole("button", { name: "Save note" }));

    await waitFor(() =>
      expect(actions.pinNoteAction).toHaveBeenCalledWith({ id: "not_kickoff", pinned: true }),
    );
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
  });
});
