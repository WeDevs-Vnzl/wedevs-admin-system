import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShareAccessLogRowDTO } from "@/lib/validators/shares";

const actions = vi.hoisted(() => ({
  revokeShareLinkAction: vi.fn(),
  setShareDocumentAccessKeyAction: vi.fn(),
  updateShareLinkAction: vi.fn(),
  getShareableDocumentAction: vi.fn(),
  listShareAccessLogAction: vi.fn(),
}));
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("../actions", () => actions);
vi.mock("@/features/documents/actions", () => ({ searchDocumentsAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ShareDetail } from "./share-detail";
import { TOKEN, installDomStubs, renderWithIntl, shareDetail, shareableDocs } from "./test-utils";

const logRows: ShareAccessLogRowDTO[] = [
  {
    id: "sal_0001",
    shareLinkId: "shl_0001",
    event: "UNLOCK_FAILED",
    documentId: "doc_0001",
    documentTitle: "Master agreement",
    visitor: "a1b2c3d4",
    userAgent: "Mozilla/5.0",
    createdAt: "2026-10-10T15:00:00.000Z",
  },
  {
    id: "sal_0002",
    shareLinkId: "shl_0001",
    event: "VIEW",
    documentId: null,
    documentTitle: null,
    visitor: "e5f6a7b8",
    userAgent: null,
    createdAt: "2026-10-09T15:00:00.000Z",
  },
];
const accessLog = { items: logRows, total: 2, page: 1, pageSize: 25, pageCount: 1 };

function renderDetail(overrides: Partial<Parameters<typeof ShareDetail>[0]> = {}) {
  return renderWithIntl(
    <ShareDetail
      share={shareDetail}
      shareableDocuments={shareableDocs.slice(0, 2)}
      accessLog={accessLog}
      canUpdate
      {...overrides}
    />,
  );
}

beforeAll(installDomStubs);
beforeEach(() => {
  vi.clearAllMocks();
  actions.revokeShareLinkAction.mockResolvedValue({ ok: true, data: shareDetail });
});

describe("ShareDetail", () => {
  it("shows the public URL and its QR code", async () => {
    renderDetail();
    expect(screen.getByDisplayValue(`http://localhost:3000/s/${TOKEN}`)).toBeInTheDocument();
    const qr = await screen.findByRole("img", { name: "QR code of the public link" });
    expect(qr.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
  });

  it("shows the counters, failed unlocks included", () => {
    renderDetail();
    const counters = screen.getByRole("group", { name: "Activity" });
    expect(within(counters).getByText("Views").nextElementSibling).toHaveTextContent("12");
    expect(within(counters).getByText("Downloads").nextElementSibling).toHaveTextContent("4");
    expect(within(counters).getByText("Unlocks").nextElementSibling).toHaveTextContent("2");
    expect(within(counters).getByText("Failed unlocks").nextElementSibling).toHaveTextContent("3");
  });

  it("lists the documents with their version pin and key state", () => {
    renderDetail();
    const docs = screen.getByRole("group", { name: "Documents" });
    expect(within(docs).getByText("v2 (pinned)")).toBeInTheDocument();
    expect(within(docs).getByText("Always the latest (v1)")).toBeInTheDocument();
    expect(
      within(docs).getByRole("switch", { name: "Require an access key for Master agreement" }),
    ).toBeChecked();
    expect(
      within(docs).getByRole("switch", { name: "Require an access key for NDA" }),
    ).not.toBeChecked();
  });

  it("revokes the link after the confirmation", async () => {
    const user = userEvent.setup();
    renderDetail();
    await user.click(screen.getByRole("button", { name: "Revoke link" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Revoke this link?" });
    expect(actions.revokeShareLinkAction).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole("button", { name: "Revoke" }));
    await waitFor(() =>
      expect(actions.revokeShareLinkAction).toHaveBeenCalledWith({ id: "shl_0001" }),
    );
    expect(router.refresh).toHaveBeenCalled();
  });

  it("hides the management controls of a revoked link and from a role that cannot update", () => {
    const { unmount } = renderDetail({
      share: { ...shareDetail, status: "REVOKED", revokedAt: "2026-10-11T10:00:00.000Z" },
    });
    expect(screen.queryByRole("button", { name: "Revoke link" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit link" })).not.toBeInTheDocument();
    unmount();
    renderDetail({ canUpdate: false });
    expect(screen.queryByRole("button", { name: "Revoke link" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("shows a regenerated key once and never again after closing", async () => {
    actions.setShareDocumentAccessKeyAction.mockResolvedValue({
      ok: true,
      data: {
        shareLinkId: "shl_0001",
        documentId: "doc_0001",
        action: "regenerate",
        requiresAccessKey: true,
        accessKeyUpdatedAt: "2026-10-12T10:00:00.000Z",
        accessKey: "N3w-Key-Shown-Once",
      },
    });
    const user = userEvent.setup();
    renderDetail();
    await user.click(
      screen.getByRole("button", { name: "Regenerate the key of Master agreement" }),
    );
    const confirm = await screen.findByRole("alertdialog", { name: "Regenerate the access key?" });
    await user.click(within(confirm).getByRole("button", { name: "Regenerate" }));

    await waitFor(() =>
      expect(actions.setShareDocumentAccessKeyAction).toHaveBeenCalledWith({
        shareLinkId: "shl_0001",
        documentId: "doc_0001",
        action: "regenerate",
      }),
    );
    const keys = await screen.findByRole("dialog", { name: "Copy the access keys now" });
    expect(within(keys).getByDisplayValue("N3w-Key-Shown-Once")).toBeInTheDocument();
    await user.click(within(keys).getByRole("button", { name: "I have copied the keys" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Copy the access keys now" })).toBeNull(),
    );
    expect(screen.queryByDisplayValue("N3w-Key-Shown-Once")).not.toBeInTheDocument();
    expect(screen.queryByText("N3w-Key-Shown-Once")).not.toBeInTheDocument();
  });

  it("generates a key when the switch is turned on and removes it after confirming", async () => {
    actions.setShareDocumentAccessKeyAction.mockImplementation(async (input) => ({
      ok: true,
      data: {
        ...input,
        requiresAccessKey: input.action !== "remove",
        accessKeyUpdatedAt: null,
        accessKey: input.action === "remove" ? null : "Fresh-Key-0002",
      },
    }));
    const user = userEvent.setup();
    renderDetail();
    await user.click(screen.getByRole("switch", { name: "Require an access key for NDA" }));
    await waitFor(() =>
      expect(actions.setShareDocumentAccessKeyAction).toHaveBeenCalledWith({
        shareLinkId: "shl_0001",
        documentId: "doc_0002",
        action: "generate",
      }),
    );
    const keys = await screen.findByRole("dialog", { name: "Copy the access keys now" });
    await user.click(within(keys).getByRole("button", { name: "I have copied the keys" }));

    await user.click(
      screen.getByRole("switch", { name: "Require an access key for Master agreement" }),
    );
    const confirm = await screen.findByRole("alertdialog", { name: "Remove the access key?" });
    await user.click(within(confirm).getByRole("button", { name: "Remove key" }));
    await waitFor(() =>
      expect(actions.setShareDocumentAccessKeyAction).toHaveBeenLastCalledWith({
        shareLinkId: "shl_0001",
        documentId: "doc_0001",
        action: "remove",
      }),
    );
  });

  it("renders the access table with events, documents and visitors", () => {
    renderDetail();
    const table = screen.getByRole("table", { name: "Access log" });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(within(rows[1]!).getByText("Unlock failed")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Master agreement")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("a1b2c3d4")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("Viewed")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("Whole link")).toBeInTheDocument();
  });

  it("loads another page of the access table through the action", async () => {
    actions.listShareAccessLogAction.mockResolvedValue({
      ok: true,
      data: { items: [logRows[1]], total: 26, page: 2, pageSize: 25, pageCount: 2 },
    });
    const user = userEvent.setup();
    renderDetail({ accessLog: { ...accessLog, total: 26, pageCount: 2 } });
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() =>
      expect(actions.listShareAccessLogAction).toHaveBeenCalledWith(
        expect.objectContaining({ shareLinkId: "shl_0001", page: 2 }),
      ),
    );
  });
});
