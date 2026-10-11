import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  archiveNoteAction: vi.fn(),
  exportNotesCsvAction: vi.fn(),
  listNotesAction: vi.fn(),
  assignTagsAction: vi.fn(),
  listTagsAction: vi.fn(),
}));
const mocks = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
  exportCsv: vi.fn(),
  query: { page: 1, pageSize: 25, includeArchived: false, filters: {} } as Record<string, unknown>,
}));

vi.mock("@/features/notes/actions", () => ({
  archiveNoteAction: actions.archiveNoteAction,
  exportNotesCsvAction: actions.exportNotesCsvAction,
  listNotesAction: actions.listNotesAction,
}));
vi.mock("@/features/tags/actions", () => ({
  assignTagsAction: actions.assignTagsAction,
  listTagsAction: actions.listTagsAction,
}));
vi.mock("@/features/export/use-csv-export", () => ({ useCsvExport: () => mocks.exportCsv }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/components/ui/data-table", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/components/ui/data-table")>();
  return {
    ...original,
    useTableUrlState: () => ({ query: mocks.query, setQuery: vi.fn() }),
  };
});

import enCommon from "@/i18n/messages/en/common.json";
import enEnums from "@/i18n/messages/en/enums.json";
import enForms from "@/i18n/messages/en/forms.json";
import enNotes from "@/i18n/messages/en/notes.json";
import enPatterns from "@/i18n/messages/en/patterns.json";
import enTable from "@/i18n/messages/en/table.json";
import enTags from "@/i18n/messages/en/tags.json";
import type { NoteListRowDTO } from "@/lib/validators/notes";
import { NOTE_COLUMN_IDS } from "../columns";
import { NotesTable, type NotesTableProps } from "./notes-table";

const messages = {
  common: enCommon,
  enums: enEnums,
  forms: enForms,
  notes: enNotes,
  patterns: enPatterns,
  table: enTable,
  tags: enTags,
};

const author = (id: string, name: string) => ({ id, name, imageUrl: null });
function row(overrides: Partial<NoteListRowDTO> & { id: string; title: string }): NoteListRowDTO {
  return {
    excerpt: "contenido",
    author: author("usr_lucia_ramos", "Lucía Ramos"),
    pinned: false,
    tags: [],
    links: [{ id: "cli_kairos", label: "Kairos Studio", type: "CLIENT", code: "CLI-0001" }],
    attachmentCount: 0,
    createdAt: "2026-09-01T15:00:00.000Z",
    updatedAt: "2026-09-01T15:00:00.000Z",
    archivedAt: null,
    ...overrides,
  };
}

const ownNote = row({ id: "not_mine", title: "Mine", author: author("usr_andres_molina", "Andrés Molina") });
const otherNote = row({ id: "not_theirs", title: "Theirs" });
const rows = [ownNote, otherNote];

const props = (overrides: Partial<NotesTableProps> = {}): NotesTableProps => ({
  initialRows: rows,
  initialTotal: rows.length,
  viewerId: "usr_andres_molina",
  canArchiveAll: false,
  canArchiveOwn: true,
  canTag: true,
  canCreateTags: true,
  ...overrides,
});

function tree(overrides: Partial<NotesTableProps> = {}) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <NotesTable {...props(overrides)} />
    </NextIntlClientProvider>
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
  actions.listNotesAction.mockResolvedValue({
    ok: true,
    data: { items: rows, total: rows.length, page: 1, pageSize: 25, pageCount: 1 },
  });
  actions.archiveNoteAction.mockResolvedValue({ ok: true, data: { id: "not_mine", archivedAt: "x" } });
});

afterEach(() => {
  mocks.query = { page: 1, pageSize: 25, includeArchived: false, filters: {} };
  vi.clearAllMocks();
});

describe("NotesTable", () => {
  it("reloads the rows through the list action when the facets change", async () => {
    const { rerender } = render(tree());
    expect(actions.listNotesAction).not.toHaveBeenCalled();

    mocks.query = {
      page: 1,
      pageSize: 25,
      includeArchived: false,
      q: "contrato",
      filters: {
        linkedEntityType: "CLIENT",
        authorId: "usr_andres_molina",
        createdAt: ["2026-01-01", "2026-02-28"],
      },
    };
    rerender(tree());

    await waitFor(() =>
      expect(actions.listNotesAction).toHaveBeenCalledWith(
        expect.objectContaining({
          q: "contrato",
          linkedEntityType: "CLIENT",
          authorId: "usr_andres_molina",
          createdFrom: "2026-01-01",
          createdTo: "2026-02-28",
        }),
      ),
    );
  });

  it("lets a Member archive their own notes only (the own-notes rule)", () => {
    render(tree({ canArchiveAll: false, canArchiveOwn: true, viewerId: "usr_andres_molina" }));
    const archiveButtons = screen.getAllByRole("button", { name: /^Archive / });
    expect(archiveButtons).toHaveLength(1);
    expect(archiveButtons[0]).toHaveAccessibleName("Archive Mine");
  });

  it("lets an Owner or Admin archive every note", () => {
    render(tree({ canArchiveAll: true, canArchiveOwn: true }));
    expect(screen.getAllByRole("button", { name: /^Archive / })).toHaveLength(2);
  });

  it("archives a note after the confirmation and reloads the rows", async () => {
    render(tree({ canArchiveAll: false, canArchiveOwn: true }));
    await userEvent.click(screen.getByRole("button", { name: "Archive Mine" }));
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /archive/i }));
    await waitFor(() =>
      expect(actions.archiveNoteAction).toHaveBeenCalledWith({ id: "not_mine" }),
    );
    await waitFor(() => expect(actions.listNotesAction).toHaveBeenCalled());
  });

  it("sends only export columns the export action accepts (B1: the attachments column)", async () => {
    render(tree());
    await userEvent.click(screen.getByRole("button", { name: "Export" }));

    expect(mocks.exportCsv).toHaveBeenCalledTimes(1);
    const columns: string[] = mocks.exportCsv.mock.calls[0]?.[1] ?? [];
    expect(columns).toContain("attachments");
    for (const id of columns) expect(NOTE_COLUMN_IDS).toContain(id);
  });

  it("returns focus to the row's archive button when the confirmation is cancelled (m1)", async () => {
    render(tree({ canArchiveAll: false, canArchiveOwn: true }));
    const opener = screen.getByRole("button", { name: "Archive Mine" });
    opener.focus();
    await userEvent.click(opener);
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /cancel/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Archive Mine" })).toHaveFocus());
  });
});
