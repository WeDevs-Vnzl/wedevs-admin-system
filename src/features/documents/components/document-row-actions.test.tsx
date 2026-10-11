import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enDocuments from "@/i18n/messages/en/documents.json";
import esDocuments from "@/i18n/messages/es/documents.json";
import { DocumentRowActions } from "./document-row-actions";

const actions = vi.hoisted(() => ({ unlinkDocumentAction: vi.fn() }));
const router = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("../actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const target = { entityType: "CLIENT" as const, entityId: "cli_0001" };

function renderRow(locale: "es" | "en" = "en") {
  const messages = { documents: locale === "es" ? esDocuments : enDocuments };
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <DocumentRowActions documentId="doc_0001" documentTitle="Contrato marco" target={target} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  actions.unlinkDocumentAction.mockReset();
  router.refresh.mockReset();
});

describe("DocumentRowActions", () => {
  it("unlinks only this record's link, after confirmation, and refreshes the tab", async () => {
    actions.unlinkDocumentAction.mockResolvedValue({ ok: true, data: [] });
    renderRow();

    await userEvent.click(screen.getByRole("button", { name: "Unlink: Contrato marco" }));
    expect(actions.unlinkDocumentAction).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole("button", { name: "Unlink" }));

    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
    expect(actions.unlinkDocumentAction).toHaveBeenCalledWith({ documentId: "doc_0001", target });
  });

  it("does nothing when the confirmation is cancelled", async () => {
    renderRow();
    await userEvent.click(screen.getByRole("button", { name: "Unlink: Contrato marco" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(actions.unlinkDocumentAction).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("keeps the tab as it is when the action refuses", async () => {
    actions.unlinkDocumentAction.mockResolvedValue({
      ok: false,
      error: { code: "FORBIDDEN", message: "errors.forbidden" },
    });
    renderRow();
    await userEvent.click(screen.getByRole("button", { name: "Unlink: Contrato marco" }));
    await userEvent.click(await screen.findByRole("button", { name: "Unlink" }));
    await waitFor(() => expect(actions.unlinkDocumentAction).toHaveBeenCalled());
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("renders in Spanish", async () => {
    renderRow("es");
    expect(screen.getByRole("button", { name: "Desvincular: Contrato marco" })).toBeInTheDocument();
  });
});
