import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enClients from "@/i18n/messages/en/clients.json";
import enCommon from "@/i18n/messages/en/common.json";
import enEnums from "@/i18n/messages/en/enums.json";
import enPatterns from "@/i18n/messages/en/patterns.json";
import enTags from "@/i18n/messages/en/tags.json";
import { ClientDetailHeader } from "./client-detail-header";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/clients/actions", () => ({
  archiveClientsAction: vi.fn(),
  restoreClientAction: vi.fn(),
  setClientStatusAction: vi.fn(),
}));

const messages = {
  clients: enClients,
  common: enCommon,
  enums: enEnums,
  patterns: enPatterns,
  tags: enTags,
};

const client = {
  id: "cli_kairos",
  code: "CLI-0001",
  tradeName: "Kairos Studio",
  kind: "EMPRESA" as const,
  country: "VE",
  status: "ACTIVO" as const,
  tags: [],
  archivedAt: null as string | null,
};

function renderHeader(
  overrides: Partial<typeof client> = {},
  permissions = { canUpdate: true, canArchive: true, canRestore: false },
) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ClientDetailHeader client={{ ...client, ...overrides }} permissions={permissions} />
    </NextIntlClientProvider>,
  );
}

async function openMoreMenu() {
  await userEvent.click(screen.getByRole("button", { name: "More actions" }));
}

describe("ClientDetailHeader", () => {
  beforeEach(() => {
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  it("offers Change status on an active client", async () => {
    renderHeader();
    await openMoreMenu();
    expect(screen.getByRole("menuitem", { name: "Change status" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Archive client" })).toBeInTheDocument();
  });

  it("removes the More menu of an archived client: Change status and Archive both wait for a restore", () => {
    renderHeader(
      { archivedAt: "2026-09-01T15:00:00.000Z" },
      { canUpdate: true, canArchive: true, canRestore: true },
    );
    expect(screen.queryByRole("button", { name: "More actions" })).not.toBeInTheDocument();
  });

  it("hides the More menu from a Member, who may neither change the status nor archive", () => {
    renderHeader({}, { canUpdate: false, canArchive: false, canRestore: false });
    expect(screen.queryByRole("button", { name: "More actions" })).not.toBeInTheDocument();
  });
});
