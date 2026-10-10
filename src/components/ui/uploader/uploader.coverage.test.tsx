import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import enForms from "@/i18n/messages/en/forms.json";
import enValidation from "@/i18n/messages/en/validation.json";
import type { ActionResult } from "@/lib/validators/common";
import type { FileDTO, UploadAdapter, UploadTarget } from "@/lib/validators/files";
import { Uploader, type UploaderProps } from "./uploader";

const messages = { forms: enForms, validation: enValidation, common: { errors: { FORBIDDEN: "No permission" } } };

function dto(id: string, name: string, size = 10): FileDTO {
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

function adapterOf(overrides: Partial<UploadAdapter> = {}): UploadAdapter {
  let n = 0;
  return {
    requestUpload: vi.fn(async () => {
      n += 1;
      return { ok: true, data: { fileId: `f${n}`, url: null } satisfies UploadTarget } as ActionResult<UploadTarget>;
    }),
    put: vi.fn(async (_t, _f, options) => options?.onProgress?.(1)),
    confirmUpload: vi.fn(async (id) => ({ ok: true, data: dto(id, `${id}.pdf`) })) as UploadAdapter["confirmUpload"],
    ...overrides,
  };
}

function file(name: string, size = 2048, type = "application/pdf"): File {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
}

function setup(props: Partial<UploaderProps> = {}, adapter = adapterOf()) {
  const user = userEvent.setup({ applyAccept: false });
  const utils = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <Uploader adapter={adapter} context="general" {...props} />
    </NextIntlClientProvider>,
  );
  const input = utils.container.querySelector<HTMLInputElement>('input[type="file"]') as HTMLInputElement;
  return { user, adapter, input, ...utils };
}

describe("Uploader accessibility", () => {
  it("hides the native file input from assistive tech; the Browse button is the only control", () => {
    const { input } = setup();
    expect(input).toHaveAttribute("aria-hidden", "true");
    expect(input).toHaveAttribute("tabindex", "-1");
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: enForms.uploader.browse })).toBeInTheDocument();
  });

  it("keeps the visible text as the Browse name and describes it with the caller's label (WCAG 2.5.3)", () => {
    setup({ id: "attachments", "aria-label": "Attachments" });
    const button = screen.getByRole("button", { name: enForms.uploader.browse });
    expect(button).toHaveAttribute("id", "attachments");
    expect(button).not.toHaveAttribute("aria-label");
    expect(button).toHaveAccessibleDescription("Attachments");
  });

  it("has no description when the caller passes no label", () => {
    setup();
    expect(screen.getByRole("button", { name: enForms.uploader.browse })).not.toHaveAttribute(
      "aria-describedby",
    );
  });

  it("opens the native picker from the Browse button", async () => {
    const { user, input } = setup();
    const click = vi.spyOn(input, "click");
    await user.click(screen.getByRole("button", { name: enForms.uploader.browse }));
    expect(click).toHaveBeenCalled();
  });
});

describe("Uploader behaviour", () => {
  it("shows existing files and removes them reporting the new list", async () => {
    const onChange = vi.fn();
    const { user } = setup({ defaultFiles: [dto("a", "a.pdf", 500), dto("b", "b.pdf", 3 * 1024 * 1024)], onChange });

    expect(screen.getByText("500 byte")).toBeInTheDocument();
    expect(screen.getByText("3 MB")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove a.pdf" }));
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ id: "b" })]);
  });

  it("keeps only the latest file when multiple is off and clears the previous one", async () => {
    const onChange = vi.fn();
    const { user, input } = setup({ multiple: false, onChange });

    await user.upload(input, file("one.pdf"));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ id: "f1" })]));
    await user.upload(input, file("two.pdf"));

    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ id: "f2" })]));
    expect(screen.queryByText("one.pdf")).not.toBeInTheDocument();
    expect(screen.getByText("two.pdf")).toBeInTheDocument();
  });

  it("highlights the zone while dragging and ignores a drop when disabled", () => {
    const { container, rerender, adapter } = setup();
    const zone = container.querySelector('[data-slot="uploader-dropzone"]') as HTMLElement;

    fireEvent.dragOver(zone);
    expect(zone).toHaveAttribute("data-dragging", "true");
    expect(screen.getByText(enForms.uploader.dropActive)).toBeInTheDocument();
    fireEvent.dragLeave(zone);
    expect(zone).not.toHaveAttribute("data-dragging");

    rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <Uploader adapter={adapter} context="general" disabled />
      </NextIntlClientProvider>,
    );
    fireEvent.dragOver(zone);
    expect(zone).not.toHaveAttribute("data-dragging");
    fireEvent.drop(zone, { dataTransfer: { files: [file("x.pdf")] } });
    expect(adapter.requestUpload).not.toHaveBeenCalled();
  });

  it("ignores an empty selection", () => {
    const { input, adapter } = setup();
    fireEvent.change(input, { target: { files: [] } });
    expect(adapter.requestUpload).not.toHaveBeenCalled();
  });

  it("shows the generic failure when the adapter throws and when confirm is refused", async () => {
    const throwing = adapterOf({
      put: vi.fn(async () => {
        throw new Error("network");
      }),
    });
    const first = setup({}, throwing);
    await first.user.upload(first.input, file("a.pdf"));
    expect(await screen.findByRole("alert")).toHaveTextContent(enForms.uploader.failed);
    first.unmount();

    const refusing = adapterOf({
      confirmUpload: vi.fn(async () => ({
        ok: false,
        error: { code: "FORBIDDEN", message: "common.errors.FORBIDDEN" },
      })) as unknown as UploadAdapter["confirmUpload"],
    });
    const second = setup({}, refusing);
    await second.user.upload(second.input, file("b.pdf"));
    expect(await screen.findByRole("alert")).toHaveTextContent("No permission");
  });

  it("drops the result when the file is removed while uploading", async () => {
    let release: () => void = () => undefined;
    const slow = adapterOf({
      put: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      ),
    });
    const onChange = vi.fn();
    const { user, input } = setup({ onChange }, slow);

    await user.upload(input, file("slow.pdf"));
    await waitFor(() => expect(slow.put).toHaveBeenCalled());
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove slow.pdf" }));
    release();

    await waitFor(() => expect(screen.queryByText("slow.pdf")).not.toBeInTheDocument());
    expect(slow.confirmUpload).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows the adapter's request error", async () => {
    const denied = adapterOf({
      requestUpload: vi.fn(async () => ({
        ok: false,
        error: { code: "FORBIDDEN", message: "common.errors.FORBIDDEN" },
      })) as unknown as UploadAdapter["requestUpload"],
    });
    const { user, input } = setup({}, denied);
    await user.upload(input, file("a.pdf"));
    expect(await screen.findByRole("alert")).toHaveTextContent("No permission");
  });
});
