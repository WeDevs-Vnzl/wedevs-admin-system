import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({ listShareLinksAction: vi.fn() }));
vi.mock("../actions", () => actions);
vi.mock("@/features/clients/actions", () => ({ searchClientsAction: vi.fn() }));
vi.mock("@/features/preferences/actions", () => ({ setPreferenceAction: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { SharesTable } from "./shares-table";
import { installDomStubs, listRow, renderWithIntl } from "./test-utils";

const revoked = {
  ...listRow,
  id: "shl_0002",
  title: "Old proposal",
  client: null,
  status: "REVOKED" as const,
  expiresAt: null,
  lastAccessedAt: null,
};

function renderTable() {
  return renderWithIntl(
    <NuqsTestingAdapter>
      <SharesTable initialRows={[listRow, revoked]} initialTotal={2} />
    </NuqsTestingAdapter>,
  );
}

beforeAll(installDomStubs);
beforeEach(() => {
  vi.clearAllMocks();
  actions.listShareLinksAction.mockResolvedValue({
    ok: true,
    data: { items: [listRow], total: 1, page: 1, pageSize: 25, pageCount: 1 },
  });
});

describe("SharesTable", () => {
  it("shows each link with its status, counters and expiry, without reloading", () => {
    renderTable();
    const title = screen.getByRole("link", { name: "Contract documents" });
    expect(title).toHaveAttribute("href", "/documents/shares/shl_0001");
    const row = title.closest("tr")!;
    expect(row).toHaveTextContent("Kairos Studio");
    expect(row).toHaveTextContent("Active");
    expect(row).toHaveTextContent("2 (1 with key)");
    expect(row).toHaveTextContent("12");
    expect(row).toHaveTextContent("4");
    expect(row).toHaveTextContent("3");
    expect(row).toHaveTextContent("Dec 31, 2026");

    const other = screen.getByRole("link", { name: "Old proposal" }).closest("tr")!;
    expect(other).toHaveTextContent("Revoked");
    expect(other).toHaveTextContent("Never");
    expect(actions.listShareLinksAction).not.toHaveBeenCalled();
  });

  it("reloads through the action with the header sort", async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(screen.getByRole("button", { name: "Sort by Title" }));
    await waitFor(() =>
      expect(actions.listShareLinksAction).toHaveBeenCalledWith(
        expect.objectContaining({ sort: "title:asc" }),
      ),
    );
  });
});
