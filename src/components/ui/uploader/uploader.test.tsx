import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import enForms from "@/i18n/messages/en/forms.json";
import enValidation from "@/i18n/messages/en/validation.json";
import esForms from "@/i18n/messages/es/forms.json";
import esValidation from "@/i18n/messages/es/validation.json";
import type { ActionResult } from "@/lib/validators/common";
import type { FileDTO, UploadAdapter, UploadContext, UploadTarget } from "@/lib/validators/files";
import { Uploader } from "./uploader";

const MB = 1024 * 1024;

function renderIntl(ui: React.ReactNode, locale: "es" | "en" = "es") {
  const messages =
    locale === "es"
      ? { forms: esForms, validation: esValidation }
      : { forms: enForms, validation: enValidation };
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function fileDto(id: string, name: string, size: number): FileDTO {
  return {
    id,
    originalName: name,
    mimeType: "application/pdf",
    sizeBytes: size,
    status: "READY",
    uploadedById: "user-1",
    createdAt: "2026-03-15T10:00:00.000Z",
  };
}

function makeAdapter(overrides: Partial<UploadAdapter> = {}) {
  let counter = 0;
  const adapter: UploadAdapter = {
    requestUpload: vi.fn(async () => {
      counter += 1;
      return { ok: true, data: { fileId: `f${counter}`, url: null } satisfies UploadTarget } as ActionResult<UploadTarget>;
    }),
    put: vi.fn(async (_target, _file, options) => {
      options?.onProgress?.(1);
    }),
    confirmUpload: vi.fn(async (fileId) => ({
      ok: true,
      data: fileDto(fileId, `${fileId}.pdf`, 10),
    })) as UploadAdapter["confirmUpload"],
    ...overrides,
  };
  return adapter;
}

function fileOf(name: string, type: string, size = 1024): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function setup(context: UploadContext, adapter = makeAdapter(), onChange = vi.fn()) {
  const user = userEvent.setup({ applyAccept: false });
  renderIntl(<Uploader adapter={adapter} context={context} onChange={onChange} />);
  return { user, adapter, onChange, input: screen.getByLabelText("Seleccionar archivos") };
}

describe("Uploader", () => {
  it("runs request → put → confirm for an allowed file and reports it", async () => {
    const { user, adapter, onChange, input } = setup("general");

    await user.upload(input, fileOf("contrato.pdf", "application/pdf"));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(adapter.requestUpload).toHaveBeenCalledWith({
      name: "contrato.pdf",
      mime: "application/pdf",
      size: 1024,
      context: "general",
    });
    expect(adapter.put).toHaveBeenCalledTimes(1);
    expect(adapter.confirmUpload).toHaveBeenCalledWith("f1");
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ id: "f1" })]);
    expect(await screen.findByText("Listo")).toBeInTheDocument();
  });

  it("rejects a disallowed MIME type without touching the adapter", async () => {
    const { user, adapter, onChange, input } = setup("general");

    await user.upload(input, fileOf("virus.exe", "application/x-msdownload"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Tipo de archivo no permitido");
    expect(adapter.requestUpload).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("rejects a GIF for payment receipts (images allowed there are PNG/JPG/WEBP)", async () => {
    const receipts = setup("payment_receipt");
    await receipts.user.upload(receipts.input, fileOf("anim.gif", "image/gif"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Tipo de archivo no permitido");
    expect(receipts.adapter.requestUpload).not.toHaveBeenCalled();
  });

  it("enforces 25 MB in the general context", async () => {
    const { user, adapter, input } = setup("general");

    await user.upload(input, fileOf("grande.pdf", "application/pdf", 25 * MB + 1));

    expect(await screen.findByRole("alert")).toHaveTextContent("tamaño máximo de 25 MB");
    expect(adapter.requestUpload).not.toHaveBeenCalled();
  });

  it("enforces 10 MB for payment receipts, where 11 MB is rejected", async () => {
    const { user, adapter, input } = setup("payment_receipt");

    await user.upload(input, fileOf("recibo.pdf", "application/pdf", 11 * MB));

    expect(await screen.findByRole("alert")).toHaveTextContent("tamaño máximo de 10 MB");
    expect(adapter.requestUpload).not.toHaveBeenCalled();
  });

  it("accepts the same 11 MB file in the general context", async () => {
    const { user, adapter, input } = setup("general");

    await user.upload(input, fileOf("recibo.pdf", "application/pdf", 11 * MB));

    await waitFor(() => expect(adapter.confirmUpload).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("rejects an empty file", async () => {
    const { user, input } = setup("general");
    await user.upload(input, fileOf("vacio.pdf", "application/pdf", 0));
    expect(await screen.findByRole("alert")).toHaveTextContent("El archivo está vacío");
  });

  it("uploads files dropped on the zone", async () => {
    const { adapter, onChange } = setup("general");
    const zone = document.querySelector("[data-slot=uploader-dropzone]") as HTMLElement;

    fireEvent.drop(zone, { dataTransfer: { files: [fileOf("a.png", "image/png")] } });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(adapter.requestUpload).toHaveBeenCalledWith(expect.objectContaining({ name: "a.png" }));
  });

  it("shows the adapter's error and does not report the file", async () => {
    const adapter = makeAdapter({
      requestUpload: vi.fn(async () => ({
        ok: false,
        error: { code: "FORBIDDEN", message: "common.errors.FORBIDDEN" },
      })) as UploadAdapter["requestUpload"],
    });
    const onChange = vi.fn();
    const user = userEvent.setup({ applyAccept: false });
    render(
      <NextIntlClientProvider
        locale="en"
        messages={{ forms: enForms, validation: enValidation, common: { errors: { FORBIDDEN: "No permission" } } }}
      >
        <Uploader adapter={adapter} context="general" onChange={onChange} />
      </NextIntlClientProvider>,
    );

    await user.upload(screen.getByLabelText("Select files"), fileOf("a.pdf", "application/pdf"));

    expect(await screen.findByRole("alert")).toHaveTextContent("No permission");
    expect(adapter.put).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("removes a confirmed file and reports the new list", async () => {
    const { user, onChange, input } = setup("general");
    await user.upload(input, fileOf("a.pdf", "application/pdf"));
    await screen.findByText("Listo");

    await user.click(screen.getByRole("button", { name: "Quitar a.pdf" }));

    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(screen.queryByText("a.pdf")).not.toBeInTheDocument();
  });

  it("states the limit and the formats of the context", () => {
    renderIntl(<Uploader adapter={makeAdapter()} context="payment_receipt" />, "en");
    expect(screen.getByText(/Up to 10 MB per file\. Formats: PDF, PNG, JPG, JPEG, WEBP\./)).toBeInTheDocument();
  });
});
