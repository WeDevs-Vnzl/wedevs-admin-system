import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enInvoices from "@/i18n/messages/en/invoices.json";
import { attachInvoiceFileAction } from "@/features/invoices/actions";
import type { FileDTO } from "@/lib/validators/files";
import { multiRateInvoice } from "../test-data";
import { InvoiceFilePanel } from "./invoice-file-panel";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/features/invoices/actions", () => ({ attachInvoiceFileAction: vi.fn() }));
vi.mock("@/features/files/upload-adapter", () => ({ uploadAdapter: {} }));
// The uploader has its own tests: here it hands over the file the adapter already confirmed.
const confirmed: FileDTO = {
  id: "fil_new",
  originalName: "factura.pdf",
  mimeType: "application/pdf",
  sizeBytes: 2048,
  status: "READY",
  uploadedById: "usr_owner",
  createdAt: "2026-10-09T12:00:00.000Z",
};
vi.mock("@/components/ui/uploader/uploader", () => ({
  Uploader: ({ onChange }: { onChange: (files: FileDTO[]) => void }) => (
    <>
      <button type="button" onClick={() => onChange([confirmed])}>
        confirm-upload
      </button>
      <button type="button" onClick={() => onChange([])}>
        remove-file
      </button>
    </>
  ),
}));

function renderPanel(file: ReturnType<typeof multiRateInvoice>["file"], canUpdate = true) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ invoices: enInvoices }}>
      <InvoiceFilePanel invoiceId="inv_1" file={file} canUpdate={canUpdate} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("InvoiceFilePanel (C23)", () => {
  it("attaches the confirmed fileId and refreshes", async () => {
    vi.mocked(attachInvoiceFileAction).mockResolvedValue({ ok: true, data: multiRateInvoice() });
    renderPanel(null);

    await userEvent.setup().click(screen.getByRole("button", { name: "confirm-upload" }));

    await waitFor(() =>
      expect(attachInvoiceFileAction).toHaveBeenCalledWith({ id: "inv_1", fileId: "fil_new" }),
    );
    expect(mocks.toast.success).toHaveBeenCalledWith("PDF attached");
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("detaches with a null fileId", async () => {
    vi.mocked(attachInvoiceFileAction).mockResolvedValue({ ok: true, data: multiRateInvoice() });
    renderPanel({ ...confirmed, id: "fil_old" });
    await userEvent.setup().click(screen.getByRole("button", { name: "remove-file" }));
    await waitFor(() =>
      expect(attachInvoiceFileAction).toHaveBeenCalledWith({ id: "inv_1", fileId: null }),
    );
  });

  it("links the attached PDF through the FE download route and offers no uploader without update", () => {
    renderPanel({ ...confirmed, id: "fil_old" }, false);
    expect(screen.getByRole("link", { name: "Open PDF" })).toHaveAttribute(
      "href",
      "/files/fil_old/download",
    );
    expect(screen.queryByRole("button", { name: "confirm-upload" })).not.toBeInTheDocument();
  });

  it("toasts the attach error without refreshing", async () => {
    vi.mocked(attachInvoiceFileAction).mockResolvedValue({
      ok: false,
      error: { code: "VALIDATION", message: "common.errors.VALIDATION" },
    });
    renderPanel(null);
    await userEvent.setup().click(screen.getByRole("button", { name: "confirm-upload" }));
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("The PDF could not be attached"),
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
