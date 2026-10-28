import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

const queries = vi.hoisted(() => ({
  listShareLinks: vi.fn(),
  getSharePermissions: vi.fn(),
  getShareableDocuments: vi.fn(),
}));
vi.mock("../queries", () => queries);
vi.mock("./create-share-dialog", () => ({
  CreateShareDialog: (props: { origin: { id: string } }) => (
    <button type="button">create-dialog:{props.origin.id}</button>
  ),
}));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const { testMessages } = await import("./test-utils");
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({
        locale: "en",
        messages: testMessages as never,
        namespace: namespace as never,
      }),
  };
});

import { DocumentSharesTab } from "./document-shares-tab";
import { listRow, shareableDocs, testMessages } from "./test-utils";

async function renderTab() {
  const ui = await DocumentSharesTab({ documentId: "doc_0001" });
  return render(
    <NextIntlClientProvider locale="en" timeZone="America/Caracas" messages={testMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  queries.getSharePermissions.mockResolvedValue({
    canRead: true,
    canCreate: true,
    canUpdate: true,
    canUpdateDocuments: true,
  });
  queries.listShareLinks.mockResolvedValue({
    items: [listRow],
    total: 1,
    page: 1,
    pageSize: 100,
    pageCount: 1,
  });
  queries.getShareableDocuments.mockResolvedValue([shareableDocs[0]]);
});

describe("DocumentSharesTab", () => {
  it("lists the links that include the document, with status and counters", async () => {
    await renderTab();
    expect(queries.listShareLinks).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: "doc_0001" }),
    );
    const link = screen.getByRole("link", { name: "Contract documents" });
    expect(link).toHaveAttribute("href", "/documents/shares/shl_0001");
    const row = link.closest("tr")!;
    expect(row).toHaveTextContent("Active");
    expect(row).toHaveTextContent("12");
    expect(screen.getByRole("button", { name: "create-dialog:doc_0001" })).toBeInTheDocument();
  });

  it("shows an empty state when the document is in no link", async () => {
    queries.listShareLinks.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
      pageCount: 1,
    });
    await renderTab();
    expect(screen.getByText("This document is not shared yet")).toBeInTheDocument();
  });

  it("reads nothing for a role without the share grant", async () => {
    queries.getSharePermissions.mockResolvedValue({
      canRead: false,
      canCreate: false,
      canUpdate: false,
      canUpdateDocuments: true,
    });
    await renderTab();
    expect(queries.listShareLinks).not.toHaveBeenCalled();
    expect(screen.getByText("Only owners and admins manage portal links")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
