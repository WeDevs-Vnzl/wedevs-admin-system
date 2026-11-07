import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import type { PortalShareDto } from "@/lib/api/types/portal";

vi.mock("@/components/ui/pdf-viewer", () => ({
  PdfViewer: ({ url, onDownload }: { url: string; onDownload?: () => void }) => (
    <div data-testid="pdf-viewer" data-url={url} data-download={onDownload ? "yes" : "no"} />
  ),
}));

import { PortalView } from "./portal-view";

const TOKEN = "qB_oM6fupiHqU3EEP1WJdPrUEEVQLSStshw-uBByF7s";

const API = "http://api.test";
const portalUrl = (path: string) => `${API}/api/v1/portal/${TOKEN}${path}`;

const page: PortalShareDto = {
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

let calls: ReturnType<typeof mockApi>["calls"] = [];

const PDF_VIEW = {
  document: { ...page.documents[0], locked: false },
  content: {
    format: "ARCHIVO",
    fileName: "contrato.pdf",
    mimeType: "application/pdf",
    sizeBytes: 2048,
    preview: "pdf",
  },
};

/** Stubs the global `fetch` the portal client uses with a route table; the HTTP layer is the only double. */
function stubPortalApi(routes: RouteTable = {}) {
  const mock = mockApi({
    "POST /api/v1/portal/{token}/views": { status: 201, body: { recorded: true } },
    "GET /api/v1/portal/{token}/documents/{documentId}": { body: PDF_VIEW },
    ...routes,
  });
  calls = mock.calls;
  vi.stubGlobal("fetch", mock.fetch);
}

const callsTo = (method: string, suffix: string) =>
  calls.filter((c) => c.method === method && c.path.endsWith(suffix));

function renderPortal(overrides: Partial<PortalShareDto> = {}) {
  return render(<PortalView token={TOKEN} page={{ ...page, ...overrides }} />);
}

const card = (title: string) => screen.getByRole("article", { name: title });

beforeEach(() => {
  Element.prototype.scrollIntoView ??= () => {};
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", API);
  stubPortalApi();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
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
      `${portalUrl("/files/doc_contrato")}?disposition=attachment`,
    );
  });

  it("records one VIEW of the link per open, not per re-render", async () => {
    const view = renderPortal();
    await waitFor(() => expect(callsTo("POST", "/views")).toHaveLength(1));
    expect(callsTo("POST", "/views")[0]?.body).toEqual({});
    view.rerender(<PortalView token={TOKEN} page={{ ...page, title: "Otro" }} />);
    expect(callsTo("POST", "/views")).toHaveLength(1);
  });

  it("never sends Authorization on a portal request", async () => {
    const user = userEvent.setup();
    renderPortal();
    await user.click(within(card("Contrato de servicios")).getByRole("button", { name: "Ver" }));
    await screen.findByTestId("pdf-viewer");
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.every((c) => !c.headers.has("authorization"))).toBe(true);
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
    expect(viewer).toHaveAttribute(
      "data-url",
      `${portalUrl("/files/doc_contrato")}?disposition=inline`,
    );
    expect(viewer).toHaveAttribute("data-download", "yes");
    expect(callsTo("GET", "/documents/doc_contrato")).toHaveLength(1);
    await waitFor(() =>
      expect(callsTo("POST", "/views").map((c) => c.body)).toEqual([
        {},
        { documentId: "doc_contrato" },
      ]),
    );
  });

  it("offers no download in the viewer when the link does not allow it", async () => {
    const user = userEvent.setup();
    renderPortal({ allowDownload: false });
    await user.click(within(card("Contrato de servicios")).getByRole("button", { name: "Ver" }));
    expect(await screen.findByTestId("pdf-viewer")).toHaveAttribute("data-download", "no");
  });

  it("shows an error with a retry when the document cannot be read, and records no view for it", async () => {
    const user = userEvent.setup();
    stubPortalApi({
      "GET /api/v1/portal/{token}/documents/{documentId}": errorEnvelope("RATE_LIMITED"),
    });
    renderPortal();
    await user.click(within(card("Contrato de servicios")).getByRole("button", { name: "Ver" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo abrir el documento");
    expect(callsTo("POST", "/views").map((c) => c.body)).toEqual([{}]);
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
    stubPortalApi({
      "POST /api/v1/portal/{token}/documents/{documentId}/unlock": {
        body: { documentId: "doc_credenciales", unlocked: true },
      },
      "GET /api/v1/portal/{token}/documents/{documentId}": {
        body: {
          document: { ...page.documents[1], locked: false },
          content: { format: "ENLACE", url: "https://staging.example.test" },
        },
      },
    });
    const dialog = await openUnlock(user);
    const input = within(dialog).getByLabelText("Clave de acceso");
    expect(input).toHaveAttribute("type", "password");
    await user.type(input, "KAIRO-STAGE-2026");
    await user.click(within(dialog).getByRole("button", { name: "Desbloquear" }));
    const unlock = callsTo("POST", "/unlock");
    expect(unlock).toHaveLength(1);
    expect(unlock[0]?.body).toEqual({ key: "KAIRO-STAGE-2026" });
    expect(unlock[0]?.path).toBe(portalUrl("/documents/doc_credenciales/unlock").replace(API, ""));
    expect(unlock[0]?.search.toString()).toBe("");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const credenciales = card("Credenciales de staging");
    expect(within(credenciales).queryByText("Requiere clave")).not.toBeInTheDocument();
    expect(within(credenciales).getByRole("button", { name: "Ver" })).toBeInTheDocument();
    // After unlocking, the document opens (read + VIEW) and, when allowed, downloads from the BE route.
    expect(await screen.findByRole("link", { name: "Abrir enlace" })).toBeInTheDocument();
    expect(callsTo("GET", "/documents/doc_credenciales")).toHaveLength(1);
    await waitFor(() =>
      expect(callsTo("POST", "/views").map((c) => c.body)).toContainEqual({
        documentId: "doc_credenciales",
      }),
    );
    expect(within(credenciales).getByRole("link", { name: "Descargar" })).toHaveAttribute(
      "href",
      `${portalUrl("/files/doc_credenciales")}?disposition=attachment`,
    );
  });

  it("shows the wrong-key error and keeps the dialog open", async () => {
    const user = userEvent.setup();
    stubPortalApi({
      "POST /api/v1/portal/{token}/documents/{documentId}/unlock":
        errorEnvelope("ACCESS_KEY_INVALID"),
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
    expect(callsTo("POST", "/unlock")).toHaveLength(0);
  });

  it("shows the lockout state and disables the form", async () => {
    const user = userEvent.setup();
    stubPortalApi({
      "POST /api/v1/portal/{token}/documents/{documentId}/unlock":
        errorEnvelope("ACCESS_KEY_LOCKED"),
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
