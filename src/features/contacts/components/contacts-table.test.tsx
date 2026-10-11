import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enClients from "@/i18n/messages/en/clients.json";
import enCommon from "@/i18n/messages/en/common.json";
import enContacts from "@/i18n/messages/en/contacts.json";
import enPatterns from "@/i18n/messages/en/patterns.json";
import enTags from "@/i18n/messages/en/tags.json";
import enValidation from "@/i18n/messages/en/validation.json";
import type { ContactListRowDTO } from "@/lib/validators/contacts";
import { archiveContactAction, setPrimaryContactAction } from "@/features/contacts/actions";
import { ContactsTable } from "./contacts-table";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/features/contacts/actions", () => ({
  createContactAction: vi.fn(),
  updateContactAction: vi.fn(),
  setPrimaryContactAction: vi.fn(),
  archiveContactAction: vi.fn(),
}));
vi.mock("@/features/tags/components/tag-picker", () => ({ TagPicker: () => null }));

const messages = {
  clients: enClients,
  common: enCommon,
  contacts: enContacts,
  patterns: enPatterns,
  tags: enTags,
  validation: enValidation,
};

const base = {
  clientId: "cli_kairos",
  position: null,
  createdAt: "2026-10-01T12:00:00.000Z",
  updatedAt: "2026-10-01T12:00:00.000Z",
  archivedAt: null,
  tags: [],
};
const contacts: ContactListRowDTO[] = [
  {
    ...base,
    id: "con_ana",
    fullName: "Ana Ruiz",
    email: "ana@example.com",
    phone: null,
    isPrimary: true,
  },
  {
    ...base,
    id: "con_luis",
    fullName: "Luis Pérez",
    email: null,
    phone: "+584121234567",
    isPrimary: false,
  },
];

function renderTable(canManage: boolean) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ContactsTable
        clientId="cli_kairos"
        contacts={contacts}
        canManage={canManage}
        canCreateTags={false}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(setPrimaryContactAction).mockResolvedValue({ ok: true, data: {} } as never);
  vi.mocked(archiveContactAction).mockResolvedValue({ ok: true, data: {} } as never);
});

describe("ContactsTable", () => {
  it("moves the primary contact when another row is marked primary (HU-04 CA2)", async () => {
    renderTable(true);
    const row = screen.getByRole("row", { name: /Luis Pérez/ });

    await userEvent.click(within(row).getByRole("button", { name: "Mark as primary" }));

    await waitFor(() => expect(setPrimaryContactAction).toHaveBeenCalledWith({ id: "con_luis" }));
    expect(mocks.toast.success).toHaveBeenCalledWith("Primary contact updated");
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("shows the current primary as a label, not a toggle", () => {
    renderTable(true);
    const row = screen.getByRole("row", { name: /Ana Ruiz/ });
    expect(within(row).getByText("Primary")).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Mark as primary" })).not.toBeInTheDocument();
  });

  it("is read-only for Member and Viewer: no add, edit, primary or archive controls (HU-04)", () => {
    renderTable(false);
    expect(screen.queryByRole("button", { name: "New contact" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark as primary" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive Luis Pérez" })).not.toBeInTheDocument();
    expect(screen.getByText(enContacts.tab.readOnly)).toBeInTheDocument();
  });

  it("archives a contact only after the confirmation dialog", async () => {
    renderTable(true);

    await userEvent.click(screen.getByRole("button", { name: "Archive Luis Pérez" }));
    expect(archiveContactAction).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole("button", { name: "Archive" }));

    await waitFor(() => expect(archiveContactAction).toHaveBeenCalledWith({ id: "con_luis" }));
  });
});
