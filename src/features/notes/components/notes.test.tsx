import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  archiveNoteAction: vi.fn(),
  attachFileAction: vi.fn(),
  createNoteAction: vi.fn(),
  getNoteAction: vi.fn(),
  listNotesAction: vi.fn(),
  pinNoteAction: vi.fn(),
  updateNoteAction: vi.fn(),
}));
const queries = vi.hoisted(() => ({ listNotes: vi.fn(), getNotesViewer: vi.fn() }));
const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("@/features/notes/actions", () => actions);
vi.mock("@/features/notes/queries", () => queries);
vi.mock("@/features/files/upload-adapter", () => ({ uploadAdapter: {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: nav.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import enCommon from "@/i18n/messages/en/common.json";
import enForms from "@/i18n/messages/en/forms.json";
import enNotes from "@/i18n/messages/en/notes.json";
import enPatterns from "@/i18n/messages/en/patterns.json";
import enValidation from "@/i18n/messages/en/validation.json";
import esCommon from "@/i18n/messages/es/common.json";
import esForms from "@/i18n/messages/es/forms.json";
import esNotes from "@/i18n/messages/es/notes.json";
import esPatterns from "@/i18n/messages/es/patterns.json";
import esValidation from "@/i18n/messages/es/validation.json";
import { paginated } from "@/lib/validators/common";
import type { NoteDetailDTO, NoteListRowDTO } from "@/lib/validators/notes";
import { EntityNotesTab } from "./entity-notes-tab";
import { NoteCard } from "./note-card";
import { NoteComposer } from "./note-composer";
import { NotesFeed } from "./notes-feed";

const messages = {
  es: {
    common: esCommon,
    forms: esForms,
    notes: esNotes,
    patterns: esPatterns,
    validation: esValidation,
  },
  en: {
    common: enCommon,
    forms: enForms,
    notes: enNotes,
    patterns: enPatterns,
    validation: enValidation,
  },
};

function wrap(ui: React.ReactNode, locale: "es" | "en" = "es") {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const entity = { id: "cli_kairos", label: "Kairos Studio", type: "CLIENT" } as const;
const author = (id: string, name: string) => ({ id, name, imageUrl: null });
function row(overrides: Partial<NoteListRowDTO> & { id: string }): NoteListRowDTO {
  return {
    title: null,
    excerpt: "contenido de la nota",
    author: author("usr_andres_molina", "Andrés Molina"),
    pinned: false,
    tags: [],
    links: [{ id: "cli_kairos", label: "Kairos Studio", type: "CLIENT" }],
    attachmentCount: 0,
    createdAt: "2026-09-01T15:00:00.000Z",
    updatedAt: "2026-09-01T15:00:00.000Z",
    archivedAt: null,
    ...overrides,
  };
}

const pinned = row({
  id: "n_pinned",
  title: "Fijada primero",
  pinned: true,
  createdAt: "2026-07-01T15:00:00.000Z",
});
const newer = row({ id: "n_new", title: "Más reciente", createdAt: "2026-09-10T15:00:00.000Z" });
const older = row({
  id: "n_old",
  title: null,
  excerpt: "uno dos tres cuatro cinco seis siete ocho",
  author: author("usr_diego_paredes", "Diego Paredes"),
  tags: [{ id: "tag_1", name: "Urgente", color: "#ff0000" }],
  links: [
    { id: "cli_kairos", label: "Kairos Studio", type: "CLIENT" },
    { id: "pry_kairos_web", label: "Sitio web", type: "PROJECT" },
  ],
  attachmentCount: 2,
  createdAt: "2026-08-01T15:00:00.000Z",
});
const page = (items: NoteListRowDTO[]) => paginated(items, items.length, { page: 1, pageSize: 25 });

const detail: NoteDetailDTO = {
  id: "n_old",
  title: null,
  content: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "uno dos tres cuatro cinco seis siete ocho" }],
      },
      { type: "image", attrs: { fileId: "fil_1", alt: "plano.png" } },
    ],
  },
  contentText: "uno dos tres cuatro cinco seis siete ocho",
  author: author("usr_diego_paredes", "Diego Paredes"),
  pinned: false,
  tags: [{ id: "tag_1", name: "Urgente", color: "#ff0000" }],
  links: [{ id: "cli_kairos", label: "Kairos Studio", type: "CLIENT" }],
  attachments: [
    {
      id: "fil_1",
      originalName: "plano.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
      status: "READY",
      uploadedById: "usr_diego_paredes",
      createdAt: "2026-08-01T15:00:00.000Z",
    },
  ],
  createdAt: "2026-08-01T15:00:00.000Z",
  updatedAt: "2026-08-01T15:00:00.000Z",
  archivedAt: null,
};

const owner = { id: "usr_owner", role: "OWNER" } as const;
const viewer = { id: "usr_viewer", role: "VIEWER" } as const;
const member = { id: "usr_diego_paredes", role: "MEMBER" } as const;

beforeAll(() => {
  // jsdom lacks the layout APIs Radix (switch, sheet) and ProseMirror (editor) rely on.
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.assign(globalThis, { ResizeObserver: ResizeObserverStub });
  const empty = { getClientRects: () => [], getBoundingClientRect: () => new DOMRect() };
  const createRange = document.createRange.bind(document);
  document.createRange = () => Object.assign(createRange(), empty);
  Element.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset();
  nav.refresh.mockReset();
});

describe("NoteCard", () => {
  it("shows author · date, the first-words title, tags, linked records (not the current one) and the attachment count", () => {
    wrap(<NoteCard note={older} viewer={owner} currentEntityId="cli_kairos" />);
    expect(
      screen.getByRole("heading", { name: "uno dos tres cuatro cinco seis" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Urgente")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sitio web" })).toHaveAttribute(
      "href",
      "/projects/pry_kairos_web",
    );
    expect(screen.queryByRole("link", { name: "Kairos Studio" })).toBeNull();
    expect(screen.getByText("2 adjuntos")).toBeInTheDocument();
    expect(screen.getByText("1 ago 2026").tagName).toBe("TIME");
    expect(screen.getByText(/Diego Paredes/)).toBeInTheDocument();
  });

  it("expands to the rich-text preview and the attachment chips, and collapses again", async () => {
    actions.getNoteAction.mockResolvedValue({ ok: true, data: detail });
    const user = userEvent.setup();
    wrap(<NoteCard note={older} viewer={owner} />);
    await user.click(screen.getByRole("button", { name: "Ver más" }));
    expect(await screen.findByText("Imagen adjunta: plano.png")).toBeInTheDocument();
    expect(screen.getByText("plano.pdf")).toBeInTheDocument();
    expect(actions.getNoteAction).toHaveBeenCalledWith({ id: "n_old" });
    await user.click(screen.getByRole("button", { name: "Ver menos" }));
    expect(screen.queryByText("Imagen adjunta: plano.png")).toBeNull();
  });

  it("filters the actions with can(): a Viewer has none, a Member archives only their own", async () => {
    const user = userEvent.setup();
    const { unmount } = wrap(<NoteCard note={older} viewer={viewer} />);
    expect(screen.queryByRole("button", { name: "Acciones de la nota" })).toBeNull();
    unmount();

    const other = row({ id: "n_other", author: author("usr_valeria_rojas", "Valeria Rojas") });
    const { unmount: unmountOther } = wrap(<NoteCard note={other} viewer={member} />);
    await user.click(screen.getByRole("button", { name: "Acciones de la nota" }));
    expect(screen.getByRole("menuitem", { name: "Editar" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Archivar" })).toBeNull();
    unmountOther();

    wrap(<NoteCard note={older} viewer={member} />);
    await user.click(screen.getByRole("button", { name: "Acciones de la nota" }));
    expect(screen.getByRole("menuitem", { name: "Archivar" })).toBeInTheDocument();
  });

  it("renders in EN", () => {
    wrap(<NoteCard note={{ ...older, pinned: true }} viewer={owner} />, "en");
    expect(screen.getByText("2 attachments")).toBeInTheDocument();
    expect(screen.getByText("Pinned")).toBeInTheDocument();
    expect(screen.getByText("Aug 1, 2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show more" })).toBeInTheDocument();
  });
});

describe("NotesFeed", () => {
  it("renders the cards in the order the service gave (pinned first, then newest)", () => {
    wrap(<NotesFeed initial={page([pinned, newer, older])} entity={entity} viewer={owner} />);
    const titles = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual(["Fijada primero", "Más reciente", "uno dos tres cuatro cinco seis"]);
    expect(screen.getByRole("button", { name: "Nueva nota" })).toBeInTheDocument();
  });

  it("shows the empty state, with the CTA only when the viewer can create", () => {
    const { unmount } = wrap(<NotesFeed initial={page([])} entity={entity} viewer={owner} />);
    expect(screen.getByText("Aún no hay notas")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Nueva nota" })).toHaveLength(2);
    unmount();

    wrap(<NotesFeed initial={page([])} entity={entity} viewer={viewer} />);
    expect(screen.getByText("Todavía no hay notas sobre este registro.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nueva nota" })).toBeNull();
  });

  it("a Viewer sees the notes but no write action", () => {
    wrap(<NotesFeed initial={page([pinned, older])} entity={entity} viewer={viewer} />);
    expect(screen.queryByRole("button", { name: "Nueva nota" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Acciones de la nota" })).toBeNull();
  });

  it("loads more through listNotesAction with the entity filter", async () => {
    const user = userEvent.setup();
    const first = paginated([pinned], 2, { page: 1, pageSize: 25 });
    actions.listNotesAction.mockResolvedValue({
      ok: true,
      data: { ...paginated([older], 2, { page: 2, pageSize: 25 }) },
    });
    wrap(<NotesFeed initial={{ ...first, pageCount: 2 }} entity={entity} viewer={owner} />);
    await user.click(screen.getByRole("button", { name: "Cargar más" }));
    await waitFor(() => expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(2));
    expect(actions.listNotesAction).toHaveBeenCalledWith({
      entityType: "CLIENT",
      entityId: "cli_kairos",
      pageSize: 25,
      page: 2,
    });
  });

  it("pins through the action and archives after confirmation", async () => {
    const user = userEvent.setup();
    actions.pinNoteAction.mockResolvedValue({ ok: true, data: detail });
    actions.archiveNoteAction.mockResolvedValue({
      ok: true,
      data: { id: "n_new", archivedAt: "x" },
    });
    actions.listNotesAction.mockResolvedValue({ ok: true, data: page([newer]) });
    wrap(<NotesFeed initial={page([newer])} entity={entity} viewer={owner} />);

    await user.click(screen.getByRole("button", { name: "Acciones de la nota" }));
    await user.click(screen.getByRole("menuitem", { name: "Fijar" }));
    await waitFor(() =>
      expect(actions.pinNoteAction).toHaveBeenCalledWith({ id: "n_new", pinned: true }),
    );
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Acciones de la nota" }));
    await user.click(screen.getByRole("menuitem", { name: "Archivar" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getAllByRole("button").at(-1)!);
    await waitFor(() => expect(actions.archiveNoteAction).toHaveBeenCalledWith({ id: "n_new" }));
  });

  it("opens the composer pre-linked to the record from '+ Nueva nota'", async () => {
    const user = userEvent.setup();
    wrap(<NotesFeed initial={page([newer])} entity={entity} viewer={owner} />);
    await user.click(screen.getByRole("button", { name: "Nueva nota" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Kairos Studio")).toBeInTheDocument();
    expect(within(sheet).getByRole("heading", { name: "Nueva nota" })).toBeInTheDocument();
  });
});

describe("NoteComposer", () => {
  it("refuses blank content with the translated validation message and does not call the action", async () => {
    const user = userEvent.setup();
    wrap(<NoteComposer open onOpenChange={() => {}} links={[{ ...entity }]} />);
    await user.click(await screen.findByRole("button", { name: "Guardar nota" }));
    expect(await screen.findByText(esValidation.required)).toBeInTheDocument();
    expect(actions.createNoteAction).not.toHaveBeenCalled();
  });

  it("renders in EN", async () => {
    wrap(<NoteComposer open onOpenChange={() => {}} links={[{ ...entity }]} />, "en");
    expect(await screen.findByRole("heading", { name: "New note" })).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save note" })).toBeInTheDocument();
  });

  it("edit mode shows the note's own links", async () => {
    wrap(<NoteComposer open onOpenChange={() => {}} note={detail} />);
    expect(await screen.findByRole("heading", { name: "Editar nota" })).toBeInTheDocument();
    expect(screen.getByText("Kairos Studio")).toBeInTheDocument();
  });
});

describe("EntityNotesTab", () => {
  it("reads the feed and the viewer through the queries and renders the feed pre-linked", async () => {
    queries.listNotes.mockResolvedValue(page([pinned, newer]));
    queries.getNotesViewer.mockResolvedValue(owner);
    const tab = await EntityNotesTab({
      entity: { id: "cli_kairos", label: "Kairos Studio", type: "CLIENT", code: "CLI-0001" },
    });
    expect(queries.listNotes).toHaveBeenCalledWith({
      entityType: "CLIENT",
      entityId: "cli_kairos",
      pageSize: 25,
    });
    wrap(tab);
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(2);
  });

  it("rejects an entity type a note cannot hang from", async () => {
    await expect(
      EntityNotesTab({ entity: { id: "tag_1", label: "Urgente", type: "TAG" } }),
    ).rejects.toThrow();
  });
});
