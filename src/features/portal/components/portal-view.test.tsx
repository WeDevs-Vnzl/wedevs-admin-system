import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PortalShareDTO } from "@/lib/validators/shares";

const actions = vi.hoisted(() => ({
  unlockSharedDocumentAction: vi.fn(),
  openSharedDocumentAction: vi.fn(),
}));
vi.mock("../actions", () => actions);
vi.mock("@/components/ui/pdf-viewer", () => ({
  PdfViewer: ({ url, onDownload }: { url: string; onDownload?: () => void }) => (
    <div data-testid="pdf-viewer" data-url={url} data-download={onDownload ? "yes" : "no"} />
  ),
}));

import { PortalView } from "./portal-view";

const TOKEN = "qB_oM6fupiHqU3EEP1WJdPrUEEVQLSStshw-uBByF7s";

const page: PortalShareDTO = {
  title: "Entrega de documentación — Kairos Studio",
  message: "Hola equipo Kairos.",
  locale: "es",
  allowDownload: true,
  clientName: "Kairos Studio",
  expiresAt: "2026-11-08",
  documents: [
    {
      documentId: "doc_contrato",
      title: "Contrato de servicios",
      typeName: "Contrato de servicios",
      typeNameEn: "Services agreement",
      versionNumber: 2,
      versionDate: "2026-07-01",
      format: "ARCHIVO",
      locked: false,
    },
    {
      documentId: "doc_credenciales",
      title: "Credenciales de staging",
      typeName: "Credenciales",
      typeNameEn: "Credentials",
      versionNumber: 1,
      versionDate: "2026-08-01",
      format: "ENLACE",
      locked: true,
    },
  ],
};

function renderPortal(overrides: Partial<PortalShareDTO> = {}) {
  return render(<PortalView token={TOKEN} page={{ ...page, ...overrides }} />);
}

const card = (title: string) => screen.getByRole("article", { name: title });

beforeEach(() => {
  Element.prototype.scrollIntoView ??= () => {};
  actions.unlockSharedDocumentAction.mockReset();
  actions.openSharedDocumentAction.mockReset();
  actions.openSharedDocumentAction.mockResolvedValue({
    ok: true,
    data: {
      document: { ...page.documents[0], locked: false },
      content: {
        format: "ARCHIVO",
        fileName: "contrato.pdf",
        mimeType: "application/pdf",
        sizeBytes: 2048,
        preview: "pdf",
      },
    },
  });
});

describe("PortalView", () => {
  it("shows the brand, the link title, message, client and expiry in the link's language", () => {
    renderPortal();
    expect(screen.getByText("WeDevs")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: page.title })).toBeInTheDocument();
    expect(screen.getByText("Hola equipo Kairos.")).toBeInTheDocument();
    expect(screen.getByText("Kairos Studio")).toBeInTheDocument();
    expect(screen.getByText(/Disponible hasta/)).toBeInTheDocument();
    expect(screen.getByText("Este enlace es personal. No lo reenvíes.")).toBeInTheDocument();
  });

  it("lists each document with its type, version and format, and downloads through the portal route", () => {
    renderPortal();
    const contrato = card("Contrato de servicios");
    expect(within(contrato).getByText("Contrato de servicios · v2 · Archivo")).toBeInTheDocument();
    expect(within(contrato).getByRole("link", { name: "Descargar" })).toHaveAttribute(
      "href",
      `/api/s/${TOKEN}/files/doc_contrato?download=1`,
    );
  });

  it("hides every download when the link does not allow downloads", () => {
    renderPortal({ allowDownload: false });
    expect(screen.queryByRole("link", { name: "Descargar" })).not.toBeInTheDocument();
  });

  it("replaces View and Download with Unlock on a key-protected document", () => {
    renderPortal();
    const credenciales = card("Credenciales de staging");
    expect(within(credenciales).getByText("Requiere clave")).toBeInTheDocument();
    expect(within(credenciales).getByRole("button", { name: "Desbloquear" })).toBeInTheDocument();
    expect(within(credenciales).queryByRole("button", { name: "Ver" })).not.toBeInTheDocument();
    expect(within(credenciales).queryByRole("link", { name: "Descargar" })).not.toBeInTheDocument();
  });

  it("opens a PDF in the embedded viewer from the portal route", async () => {
    const user = userEvent.setup();
    renderPortal();
    await user.click(within(card("Contrato de servicios")).getByRole("button", { name: "Ver" }));
    const viewer = await screen.findByTestId("pdf-viewer");
    expect(viewer).toHaveAttribute("data-url", `/api/s/${TOKEN}/files/doc_contrato`);
    expect(viewer).toHaveAttribute("data-download", "yes");
    expect(actions.openSharedDocumentAction).toHaveBeenCalledWith({
      token: TOKEN,
      documentId: "doc_contrato",
    });
  });

  it("switches the portal to English without reloading", async () => {
    const user = userEvent.setup();
    renderPortal();
    await user.click(screen.getByRole("radio", { name: "EN" }));
    expect(
      within(card("Contrato de servicios")).getByText("Services agreement · v2 · File"),
    ).toBeInTheDocument();
    expect(screen.getByText("This link is personal. Do not forward it.")).toBeInTheDocument();
  });
});

describe("PortalView, unlock dialog", () => {
  async function openUnlock(user: ReturnType<typeof userEvent.setup>) {
    renderPortal();
    await user.click(
      within(card("Credenciales de staging")).getByRole("button", { name: "Desbloquear" }),
    );
    return screen.findByRole("dialog", { name: "Desbloquear documento" });
  }

  it("masks the key, sends it in the body only and unlocks the card", async () => {
    const user = userEvent.setup();
    actions.unlockSharedDocumentAction.mockResolvedValue({
      ok: true,
      data: { documentId: "doc_credenciales", unlocked: true },
    });
    const dialog = await openUnlock(user);
    const input = within(dialog).getByLabelText("Clave de acceso");
    expect(input).toHaveAttribute("type", "password");
    await user.type(input, "KAIRO-STAGE-2026");
    await user.click(within(dialog).getByRole("button", { name: "Desbloquear" }));
    expect(actions.unlockSharedDocumentAction).toHaveBeenCalledWith({
      token: TOKEN,
      documentId: "doc_credenciales",
      key: "KAIRO-STAGE-2026",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const credenciales = card("Credenciales de staging");
    expect(within(credenciales).queryByText("Requiere clave")).not.toBeInTheDocument();
    expect(within(credenciales).getByRole("button", { name: "Ver" })).toBeInTheDocument();
  });

  it("shows the wrong-key error and keeps the dialog open", async () => {
    const user = userEvent.setup();
    actions.unlockSharedDocumentAction.mockResolvedValue({
      ok: false,
      error: { code: "ACCESS_KEY_INVALID", message: "common.errors.ACCESS_KEY_INVALID" },
    });
    const dialog = await openUnlock(user);
    await user.type(within(dialog).getByLabelText("Clave de acceso"), "WRONG-KEY-0000");
    await user.click(within(dialog).getByRole("button", { name: "Desbloquear" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "La clave de acceso no es correcta.",
    );
    expect(within(dialog).getByLabelText("Clave de acceso")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("refuses a key shorter than 8 characters before sending it", async () => {
    const user = userEvent.setup();
    const dialog = await openUnlock(user);
    await user.type(within(dialog).getByLabelText("Clave de acceso"), "short");
    await user.click(within(dialog).getByRole("button", { name: "Desbloquear" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("al menos 8 caracteres");
    expect(actions.unlockSharedDocumentAction).not.toHaveBeenCalled();
  });

  it("shows the lockout state and disables the form", async () => {
    const user = userEvent.setup();
    actions.unlockSharedDocumentAction.mockResolvedValue({
      ok: false,
      error: { code: "ACCESS_KEY_LOCKED", message: "common.errors.ACCESS_KEY_LOCKED" },
    });
    const dialog = await openUnlock(user);
    await user.type(within(dialog).getByLabelText("Clave de acceso"), "WRONG-KEY-0005");
    await user.click(within(dialog).getByRole("button", { name: "Desbloquear" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Demasiados intentos, vuelve a intentarlo en 15 minutos.",
    );
    expect(within(dialog).getByLabelText("Clave de acceso")).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Desbloquear" })).toBeDisabled();
  });
});
