import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  createShareLinkAction: vi.fn(),
  getShareableDocumentAction: vi.fn(),
  markDocumentsSentAction: vi.fn(),
}));
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("../actions", () => actions);
vi.mock("@/features/documents/actions", () => ({ searchDocumentsAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CreateShareDialog } from "./create-share-dialog";
import { installDomStubs, renderWithIntl, shareDetail, shareableDocs } from "./test-utils";

beforeAll(installDomStubs);
beforeEach(() => {
  vi.clearAllMocks();
  actions.createShareLinkAction.mockResolvedValue({
    ok: true,
    data: { share: shareDetail, generatedKeys: [] },
  });
  actions.markDocumentsSentAction.mockResolvedValue({
    ok: true,
    data: { sent: [], skipped: [], failed: [] },
  });
});

async function open(user: ReturnType<typeof userEvent.setup>, name = "Share") {
  await user.click(screen.getByRole("button", { name }));
  return screen.findByRole("dialog", { name: "Share in the portal" });
}

describe("CreateShareDialog", () => {
  it("from a document: pins the current version by default and submits the preselected document", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <CreateShareDialog
        origin={{ type: "DOCUMENT", id: "doc_0001", label: "Master agreement" }}
        documents={[shareableDocs[0]!]}
      />,
    );
    const dialog = await open(user);
    expect(within(dialog).getByLabelText("Title")).toHaveValue("Master agreement");
    expect(
      within(dialog).getByRole("combobox", { name: "Version of Master agreement" }),
    ).toHaveTextContent("v2 (current)");

    await user.click(within(dialog).getByRole("button", { name: "Create link" }));

    await waitFor(() => expect(actions.createShareLinkAction).toHaveBeenCalledTimes(1));
    expect(actions.createShareLinkAction).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Master agreement",
        allowDownload: true,
        documents: [{ documentId: "doc_0001", versionId: "ver_0002", requiresAccessKey: false }],
      }),
    );
    expect(actions.createShareLinkAction.mock.calls[0]![0]).not.toHaveProperty("clientId");
  });

  it("offers 'always the latest version' and every version, and sends the chosen pin and key", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <CreateShareDialog
        origin={{ type: "DOCUMENT", id: "doc_0001", label: "Master agreement" }}
        documents={[shareableDocs[0]!]}
      />,
    );
    const dialog = await open(user);
    await user.click(within(dialog).getByRole("combobox", { name: "Version of Master agreement" }));
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Always the latest version",
      "v2 (current)",
      "v1",
    ]);
    await user.click(screen.getByRole("option", { name: "Always the latest version" }));
    await user.click(
      within(dialog).getByRole("switch", { name: "Require an access key for Master agreement" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Create link" }));

    await waitFor(() =>
      expect(actions.createShareLinkAction).toHaveBeenCalledWith(
        expect.objectContaining({
          documents: [{ documentId: "doc_0001", versionId: null, requiresAccessKey: true }],
        }),
      ),
    );
  });

  it("from a client: sets the client and sends only the checked documents", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <CreateShareDialog
        origin={{ type: "CLIENT", id: "cli_0001", label: "Kairos Studio" }}
        documents={shareableDocs}
        preselectedIds={["doc_0001", "doc_0003"]}
      />,
    );
    const dialog = await open(user, "Share documents…");
    expect(within(dialog).getByRole("checkbox", { name: "Include NDA" })).not.toBeChecked();
    await user.click(within(dialog).getByRole("checkbox", { name: "Include Scope" }));
    await user.click(within(dialog).getByRole("button", { name: "Create link" }));

    await waitFor(() => expect(actions.createShareLinkAction).toHaveBeenCalledTimes(1));
    expect(actions.createShareLinkAction).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "cli_0001",
        documents: [{ documentId: "doc_0001", versionId: "ver_0002", requiresAccessKey: false }],
      }),
    );
  });

  it("from a project: preselects every document when no ids are given and sets no client", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <CreateShareDialog
        origin={{ type: "PROJECT", id: "prj_0001", label: "Website" }}
        documents={shareableDocs.slice(0, 2)}
      />,
    );
    const dialog = await open(user, "Share documents…");
    await user.click(within(dialog).getByRole("button", { name: "Create link" }));

    await waitFor(() => expect(actions.createShareLinkAction).toHaveBeenCalledTimes(1));
    const input = actions.createShareLinkAction.mock.calls[0]![0];
    expect(input).not.toHaveProperty("clientId");
    expect(input.documents.map((doc: { documentId: string }) => doc.documentId)).toEqual([
      "doc_0001",
      "doc_0002",
    ]);
  });

  it("validates the title and the documents before calling the action", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <CreateShareDialog
        origin={{ type: "CLIENT", id: "cli_0001", label: "Kairos Studio" }}
        documents={shareableDocs}
        preselectedIds={[]}
      />,
    );
    const dialog = await open(user, "Share documents…");
    await user.clear(within(dialog).getByLabelText("Title"));
    await user.click(within(dialog).getByRole("button", { name: "Create link" }));

    expect(await within(dialog).findByText("Required field")).toBeInTheDocument();
    expect(within(dialog).getByText("Choose at least one document")).toBeInTheDocument();
    expect(actions.createShareLinkAction).not.toHaveBeenCalled();
  });

  it("shows a generated key once, then proposes ENVIADO for the APROBADO documents only", async () => {
    actions.createShareLinkAction.mockResolvedValue({
      ok: true,
      data: {
        share: shareDetail,
        generatedKeys: [{ documentId: "doc_0001", accessKey: "k3y-Once-0001" }],
      },
    });
    const user = userEvent.setup();
    renderWithIntl(
      <CreateShareDialog
        origin={{ type: "CLIENT", id: "cli_0001", label: "Kairos Studio" }}
        documents={shareableDocs.slice(0, 2)}
      />,
    );
    const dialog = await open(user, "Share documents…");
    await user.click(within(dialog).getByRole("button", { name: "Create link" }));

    const keys = await screen.findByRole("dialog", { name: "Copy the access keys now" });
    expect(within(keys).getByDisplayValue("k3y-Once-0001")).toBeInTheDocument();
    await user.click(within(keys).getByRole("button", { name: "I have copied the keys" }));

    const proposal = await screen.findByRole("alertdialog", {
      name: "Mark the shared documents as sent?",
    });
    expect(screen.queryByDisplayValue("k3y-Once-0001")).not.toBeInTheDocument();
    // shareDetail: doc_0001 is ENVIADO, doc_0002 is APROBADO.
    expect(within(proposal).getAllByRole("checkbox")).toHaveLength(1);
    expect(within(proposal).getByRole("checkbox", { name: "NDA" })).toBeChecked();
    await user.click(within(proposal).getByRole("button", { name: "Mark as sent" }));
    await waitFor(() =>
      expect(actions.markDocumentsSentAction).toHaveBeenCalledWith({ documentIds: ["doc_0002"] }),
    );
  });

  it("asks nothing when no shared document is APROBADO", async () => {
    actions.createShareLinkAction.mockResolvedValue({
      ok: true,
      data: {
        share: {
          ...shareDetail,
          documents: shareDetail.documents.map((doc) => ({ ...doc, documentStatus: "ENVIADO" })),
        },
        generatedKeys: [],
      },
    });
    const user = userEvent.setup();
    renderWithIntl(
      <CreateShareDialog
        origin={{ type: "DOCUMENT", id: "doc_0001", label: "Master agreement" }}
        documents={[shareableDocs[0]!]}
      />,
    );
    const dialog = await open(user);
    await user.click(within(dialog).getByRole("button", { name: "Create link" }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(actions.markDocumentsSentAction).not.toHaveBeenCalled();
  });
});
