import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/messages/en/common.json";
import enDocuments from "@/i18n/messages/en/documents.json";
import enEnums from "@/i18n/messages/en/enums.json";
import enPatterns from "@/i18n/messages/en/patterns.json";
import type { DocumentLinkDTO } from "@/lib/validators/documents";
import { DocumentDetailLinks } from "./document-detail-links";

const actions = vi.hoisted(() => ({ linkDocumentAction: vi.fn(), unlinkDocumentAction: vi.fn() }));
const search = vi.hoisted(() => ({ searchProjectsAction: vi.fn() }));
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("../actions", () => actions);
vi.mock("@/features/clients/actions", () => ({ searchClientsAction: vi.fn() }));
vi.mock("@/features/contacts/actions", () => ({ searchContactsAction: vi.fn() }));
vi.mock("@/features/projects/actions", () => search);
vi.mock("@/features/invoices/actions", () => ({ searchInvoicesAction: vi.fn() }));
vi.mock("@/features/payments/actions", () => ({ searchPaymentsAction: vi.fn() }));
vi.mock("@/features/expenses/actions", () => ({ searchExpensesAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("sonner", () => ({ toast }));
// The combobox's own search UI is tested with it; here it loads the options and picks the first one.
vi.mock("@/components/ui/async-combobox", () => ({
  AsyncCombobox: ({
    loadOptions,
    onChange,
    "aria-label": label,
  }: {
    loadOptions: (q: string) => Promise<{ value: string; label: string }[]>;
    onChange: (option: { value: string; label: string } | null) => void;
    "aria-label"?: string;
  }) => (
    <button type="button" onClick={async () => onChange((await loadOptions("har"))[0] ?? null)}>
      {label}
    </button>
  ),
}));

const links: DocumentLinkDTO[] = [
  {
    id: "dlk_1",
    entity: { type: "CLIENT", id: "cli_kairos", code: "CLI-0001", label: "Kairos" },
    createdAt: "2026-10-01T12:00:00.000Z",
  },
  {
    id: "dlk_2",
    entity: { type: "CONTACT", id: "con_ana", code: "CON-0003", label: "Ana Pérez" },
    createdAt: "2026-10-01T12:00:00.000Z",
  },
];

function renderLinks(canUpdate = true, items = links) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ common: enCommon, documents: enDocuments, enums: enEnums, patterns: enPatterns }}
    >
      <DocumentDetailLinks documentId="doc_1" links={items} canUpdate={canUpdate} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  // Radix Select needs pointer capture and scrolling, which jsdom does not implement.
  Element.prototype.scrollIntoView ??= () => undefined;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
  actions.linkDocumentAction.mockReset();
  actions.unlinkDocumentAction.mockReset();
  search.searchProjectsAction.mockReset();
  router.refresh.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

describe("DocumentDetailLinks (S7 'Vínculos')", () => {
  it("lists every linked record, linking to its page when it has one", () => {
    renderLinks();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByRole("link", { name: "Kairos" })).toHaveAttribute(
      "href",
      "/clients/cli_kairos",
    );
    expect(rows[0]).toHaveTextContent("Client");
    expect(rows[0]).toHaveTextContent("CLI-0001");
    // Contacts live inside their client: no page of their own, so plain text.
    expect(within(rows[1]!).queryByRole("link")).not.toBeInTheDocument();
    expect(rows[1]).toHaveTextContent("Ana Pérez");
  });

  it("unlinks one record after confirmation and refreshes", async () => {
    const user = userEvent.setup();
    actions.unlinkDocumentAction.mockResolvedValue({ ok: true, data: [] });
    renderLinks();
    await user.click(screen.getByRole("button", { name: "Unlink: Kairos" }));
    expect(actions.unlinkDocumentAction).not.toHaveBeenCalled();
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Unlink" }),
    );
    await waitFor(() =>
      expect(actions.unlinkDocumentAction).toHaveBeenCalledWith({
        documentId: "doc_1",
        target: { entityType: "CLIENT", entityId: "cli_kairos" },
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Record unlinked");
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("links a record found through its type's search", async () => {
    const user = userEvent.setup();
    search.searchProjectsAction.mockResolvedValue({
      ok: true,
      data: [{ type: "PROJECT", id: "prj_harbor", code: "PRJ-0002", label: "Harbor" }],
    });
    actions.linkDocumentAction.mockResolvedValue({ ok: true, data: [] });
    renderLinks();

    await user.click(screen.getByRole("combobox", { name: "Record type" }));
    await user.click(await screen.findByRole("option", { name: "Project" }));
    await user.click(screen.getByRole("button", { name: "Search a record" }));

    await waitFor(() =>
      expect(actions.linkDocumentAction).toHaveBeenCalledWith({
        documentId: "doc_1",
        target: { entityType: "PROJECT", entityId: "prj_harbor" },
      }),
    );
    expect(search.searchProjectsAction).toHaveBeenCalledWith({ q: "har" });
    expect(toast.success).toHaveBeenCalledWith("Record linked");
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("is read-only for a role without update", () => {
    renderLinks(false);
    expect(screen.queryByRole("button", { name: /^Unlink/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Record type" })).not.toBeInTheDocument();
  });

  it("shows an empty state without links", () => {
    renderLinks(true, []);
    expect(screen.getByText("This document is not linked to any record.")).toBeInTheDocument();
  });
});
