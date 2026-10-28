import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enDocuments from "@/i18n/messages/en/documents.json";
import enEnums from "@/i18n/messages/en/enums.json";
import type { DocumentVersionRowDTO } from "@/lib/validators/documents";
import { DocumentVersionHistory } from "./document-version-history";

const actions = vi.hoisted(() => ({ restoreDocumentVersionAction: vi.fn() }));
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("../actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("sonner", () => ({ toast }));

const author = { id: "usr_1", name: "Valeria Rojas", imageUrl: null };

function version(
  number: number,
  overrides: Partial<DocumentVersionRowDTO> = {},
): DocumentVersionRowDTO {
  return {
    id: `dver_${number}`,
    documentId: "doc_1",
    versionNumber: number,
    format: "MARKDOWN",
    file: null,
    url: null,
    changelog: `Notes of v${number}`,
    createdBy: author,
    createdAt: `2026-10-0${number}T15:00:00.000Z`,
    isCurrent: false,
    ...overrides,
  };
}

const markdownHistory = [
  version(3, { isCurrent: true }),
  version(2),
  version(1, { changelog: null }),
];

function renderHistory(props: Partial<Parameters<typeof DocumentVersionHistory>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ documents: enDocuments, enums: enEnums }}>
      <DocumentVersionHistory
        documentId="doc_1"
        versions={markdownHistory}
        canUpdate
        signed={false}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  actions.restoreDocumentVersionAction.mockReset();
  router.refresh.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

describe("DocumentVersionHistory (S5 'Historial')", () => {
  it("lists every version with its author, date and change notes, newest first", () => {
    renderHistory();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("v3");
    expect(rows[0]).toHaveTextContent("Current");
    expect(rows[0]).toHaveTextContent("Valeria Rojas");
    expect(within(rows[0]!).getByText("Notes of v3")).toBeInTheDocument();
    expect(within(rows[0]!).getByRole("time")).toHaveAttribute(
      "datetime",
      "2026-10-03T15:00:00.000Z",
    );
    expect(rows[2]).toHaveTextContent("No change notes");
  });

  it("links to view and download every version, and compares only the older markdown ones", () => {
    renderHistory();
    expect(screen.getByRole("link", { name: "View v2" })).toHaveAttribute(
      "href",
      "/documents/doc_1/versions/dver_2",
    );
    expect(screen.getByRole("link", { name: "Download v2" })).toHaveAttribute(
      "href",
      "/documents/doc_1/versions/dver_2/file?download=1",
    );
    expect(
      screen.getByRole("link", { name: "Compare v2 with the current version" }),
    ).toHaveAttribute("href", "/documents/doc_1/versions/dver_2/compare");
    expect(
      screen.queryByRole("link", { name: "Compare v3 with the current version" }),
    ).not.toBeInTheDocument();
  });

  it("offers no comparison for file or link versions, and downloads a link at its URL", () => {
    renderHistory({
      versions: [
        version(2, { format: "ENLACE", url: "https://drive.example.com/x", isCurrent: true }),
        version(1, { format: "ARCHIVO" }),
      ],
    });
    expect(screen.queryByRole("link", { name: /^Compare/ })).not.toBeInTheDocument();
    const download = screen.getByRole("link", { name: "Download v2" });
    expect(download).toHaveAttribute("href", "https://drive.example.com/x");
    expect(download).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("restores an older version after confirmation and refreshes", async () => {
    const user = userEvent.setup();
    actions.restoreDocumentVersionAction.mockResolvedValue({ ok: true, data: {} });
    renderHistory();
    expect(screen.queryByRole("button", { name: "Restore v3" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Restore v1" }));
    expect(actions.restoreDocumentVersionAction).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog", { name: "Restore v1?" });
    await user.click(within(dialog).getByRole("button", { name: "Restore" }));

    await waitFor(() =>
      expect(actions.restoreDocumentVersionAction).toHaveBeenCalledWith({
        documentId: "doc_1",
        versionId: "dver_1",
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Version restored");
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("reports a refused restore and keeps the page", async () => {
    const user = userEvent.setup();
    actions.restoreDocumentVersionAction.mockResolvedValue({
      ok: false,
      error: { code: "INTEGRITY_LOCK", message: "errors.integrityLock" },
    });
    renderHistory();
    await user.click(screen.getByRole("button", { name: "Restore v2" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Restore" }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("The version could not be restored"),
    );
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("offers no restore to a reader, nor on a signed document", () => {
    const { unmount } = renderHistory({ canUpdate: false });
    expect(screen.queryByRole("button", { name: /^Restore/ })).not.toBeInTheDocument();
    unmount();
    renderHistory({ signed: true });
    expect(screen.queryByRole("button", { name: /^Restore/ })).not.toBeInTheDocument();
    // Viewing and downloading stay available on a signed document.
    expect(screen.getByRole("link", { name: "View v1" })).toBeInTheDocument();
  });

  it("shows an empty state without versions", () => {
    renderHistory({ versions: [] });
    expect(screen.getByText("No version has been published yet.")).toBeInTheDocument();
  });
});
