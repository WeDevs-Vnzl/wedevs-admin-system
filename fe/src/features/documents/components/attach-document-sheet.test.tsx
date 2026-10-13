import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enDocuments from "@/i18n/messages/en/documents.json";
import enForms from "@/i18n/messages/en/forms.json";
import enValidation from "@/i18n/messages/en/validation.json";
import esDocuments from "@/i18n/messages/es/documents.json";
import esForms from "@/i18n/messages/es/forms.json";
import esValidation from "@/i18n/messages/es/validation.json";
import type { DocumentCategoryDetailDTO } from "@/lib/validators/document-types";
import type { FileDTO } from "@/lib/validators/files";

const actions = vi.hoisted(() => ({
  createDocumentAction: vi.fn(),
  uploadDocumentVersionAction: vi.fn(),
  linkDocumentAction: vi.fn(),
  searchDocumentsAction: vi.fn(),
}));
const adapter = vi.hoisted(() => ({
  requestUpload: vi.fn(),
  put: vi.fn(),
  confirmUpload: vi.fn(),
}));
const router = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("../actions", () => actions);
vi.mock("@/features/files/upload-adapter", () => ({ uploadAdapter: adapter }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { AttachDocumentSheet } from "./attach-document-sheet";

const MB = 1024 * 1024;

const clientRef = { type: "CLIENT" as const, id: "cli_0001", code: "CLI-0001", label: "Acme" };

const categories: DocumentCategoryDetailDTO[] = [
  {
    id: "dcat_legal",
    name: "Legal",
    nameEn: "Legal",
    color: null,
    order: 1,
    types: [
      {
        id: "dtyp_contrato",
        name: "Contrato",
        nameEn: "Contract",
        defaultFormat: "ARCHIVO",
        requiresSignature: false,
        hasExpiration: true,
        active: true,
        documentCount: 0,
      },
    ],
  },
];

const readyFile: FileDTO = {
  id: "fil_0001",
  originalName: "contrato.pdf",
  mimeType: "application/pdf",
  sizeBytes: 2048,
  status: "READY",
  uploadedById: "usr_1",
  createdAt: "2026-10-01T00:00:00.000Z",
};

function fileOf(name: string, type: string, size = 1024): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function fileInput(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('input[type="file"]') as HTMLInputElement;
}

function renderSheet(locale: "en" | "es" = "en") {
  const messages = {
    documents: locale === "es" ? esDocuments : enDocuments,
    forms: locale === "es" ? esForms : enForms,
    validation: locale === "es" ? esValidation : enValidation,
  };
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <AttachDocumentSheet entity={clientRef} categories={categories} />
    </NextIntlClientProvider>,
  );
}

async function openSheet(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Attach document" }));
  return screen.findByRole("dialog", { name: "Attach document" });
}

beforeEach(() => {
  for (const mock of Object.values(actions)) mock.mockReset();
  for (const mock of Object.values(adapter)) mock.mockReset();
  router.refresh.mockReset();
  adapter.requestUpload.mockResolvedValue({ ok: true, data: { fileId: readyFile.id, url: null } });
  adapter.put.mockImplementation(async (_target, _file, options) => options?.onProgress?.(1));
  adapter.confirmUpload.mockResolvedValue({ ok: true, data: readyFile });
});

describe("AttachDocumentSheet, upload mode", () => {
  it("refuses a file over the 25 MB general limit before anything is sent", async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderSheet();
    await openSheet(user);
    await user.upload(fileInput(), fileOf("grande.pdf", "application/pdf", 25 * MB + 1));
    expect(await screen.findByRole("alert")).toHaveTextContent("25 MB");
    expect(adapter.requestUpload).not.toHaveBeenCalled();
  });

  it("refuses a file type the general context does not allow", async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderSheet();
    await openSheet(user);
    await user.upload(fileInput(), fileOf("virus.exe", "application/x-msdownload"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/not allowed|allowed/i);
    expect(adapter.requestUpload).not.toHaveBeenCalled();
  });

  it("asks for a file before submitting", async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderSheet();
    await openSheet(user);
    await user.click(screen.getByRole("button", { name: "Upload and attach" }));
    expect(await screen.findByText("Attach a file to continue")).toBeInTheDocument();
    expect(actions.createDocumentAction).not.toHaveBeenCalled();
  });

  it("marks the invalid field with aria-invalid and points it at its error", async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderSheet();
    await openSheet(user);
    await user.click(screen.getByRole("button", { name: "Upload and attach" }));
    const title = await screen.findByLabelText("Title");
    expect(title).toHaveAttribute("aria-invalid", "true");
    const error = document.getElementById(title.getAttribute("aria-describedby") ?? "");
    expect(error).toHaveAttribute("role", "alert");
  });

  it("applies the title rule on the client: no document is created without a title", async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderSheet();
    await openSheet(user);
    await user.upload(fileInput(), fileOf("contrato.pdf", "application/pdf"));
    await waitFor(() => expect(adapter.confirmUpload).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Upload and attach" }));
    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));
    expect(actions.createDocumentAction).not.toHaveBeenCalled();
  });
});

describe("AttachDocumentSheet, link mode", () => {
  it("offers the link form, which cannot submit until a document is chosen", async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderSheet();
    await openSheet(user);
    await user.click(screen.getByRole("tab", { name: "Link existing" }));
    expect(await screen.findByRole("button", { name: "Link document" })).toBeDisabled();
    expect(actions.linkDocumentAction).not.toHaveBeenCalled();
  });
});

describe("AttachDocumentSheet, locale", () => {
  it("renders the trigger in Spanish", () => {
    renderSheet("es");
    expect(screen.getByRole("button", { name: "Adjuntar documento" })).toBeInTheDocument();
  });
});
