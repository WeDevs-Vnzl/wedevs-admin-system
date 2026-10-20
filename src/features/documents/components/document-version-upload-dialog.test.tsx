import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enDocuments from "@/i18n/messages/en/documents.json";
import enValidation from "@/i18n/messages/en/validation.json";
import { DocumentVersionUploadDialog } from "./document-version-upload-dialog";

const actions = vi.hoisted(() => ({ uploadNewDocumentVersionAction: vi.fn() }));
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("../actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/features/files/upload-adapter", () => ({ uploadAdapter: {} }));
// The uploader's own flow (request, PUT, confirm) is tested with it; here it only hands back a confirmed file.
vi.mock("@/components/ui/uploader", () => ({
  Uploader: ({ id, onChange }: { id?: string; onChange?: (files: unknown[]) => void }) => (
    <button
      type="button"
      id={id}
      onClick={() =>
        onChange?.([
          {
            id: "fil_new",
            originalName: "contrato-v3.pdf",
            mimeType: "application/pdf",
            sizeBytes: 1024,
            status: "READY",
            uploadedById: "usr_1",
            createdAt: "2026-10-15T12:00:00.000Z",
          },
        ])
      }
    >
      Pick file
    </button>
  ),
}));

function renderDialog(format: "ARCHIVO" | "ENLACE", signed = false) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ documents: enDocuments, validation: enValidation }}
    >
      <DocumentVersionUploadDialog documentId="doc_1" format={format} signed={signed} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  actions.uploadNewDocumentVersionAction.mockReset();
  router.refresh.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

describe("DocumentVersionUploadDialog (S5 'Nueva versión de archivo o enlace')", () => {
  it("uploads a new file version with its change notes", async () => {
    const user = userEvent.setup();
    actions.uploadNewDocumentVersionAction.mockResolvedValue({ ok: true, data: {} });
    renderDialog("ARCHIVO");

    await user.click(screen.getByRole("button", { name: "Upload new version" }));
    await user.click(await screen.findByText("Pick file"));
    await user.type(screen.getByLabelText("Change notes"), "Signed copy");
    await user.click(screen.getByRole("button", { name: "Publish version" }));

    await waitFor(() =>
      expect(actions.uploadNewDocumentVersionAction).toHaveBeenCalledWith({
        format: "ARCHIVO",
        documentId: "doc_1",
        fileId: "fil_new",
        changelog: "Signed copy",
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("New version published");
    expect(router.refresh).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("asks for the file before publishing", async () => {
    const user = userEvent.setup();
    renderDialog("ARCHIVO");
    await user.click(screen.getByRole("button", { name: "Upload new version" }));
    await user.click(await screen.findByRole("button", { name: "Publish version" }));
    expect(screen.getByText("Attach a file to continue")).toBeInTheDocument();
    expect(actions.uploadNewDocumentVersionAction).not.toHaveBeenCalled();
  });

  it("updates a link with the new address", async () => {
    const user = userEvent.setup();
    actions.uploadNewDocumentVersionAction.mockResolvedValue({ ok: true, data: {} });
    renderDialog("ENLACE");

    await user.click(screen.getByRole("button", { name: "Update link" }));
    await user.type(await screen.findByLabelText("Address (URL)"), "https://drive.example.com/v2");
    await user.click(screen.getByRole("button", { name: "Publish version" }));

    await waitFor(() =>
      expect(actions.uploadNewDocumentVersionAction).toHaveBeenCalledWith({
        format: "ENLACE",
        documentId: "doc_1",
        url: "https://drive.example.com/v2",
      }),
    );
  });

  it("refuses an address that is not http(s) before calling the server", async () => {
    const user = userEvent.setup();
    renderDialog("ENLACE");
    await user.click(screen.getByRole("button", { name: "Update link" }));
    await user.type(await screen.findByLabelText("Address (URL)"), "javascript:alert(1)");
    await user.click(screen.getByRole("button", { name: "Publish version" }));
    expect(await screen.findByLabelText("Address (URL)")).toHaveAttribute("aria-invalid", "true");
    expect(actions.uploadNewDocumentVersionAction).not.toHaveBeenCalled();
  });

  it("is locked on a signed document", () => {
    renderDialog("ARCHIVO", true);
    const trigger = screen.getByRole("button", { name: "Upload new version" });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAccessibleDescription("Signed documents accept no new versions");
  });
});
