import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/messages/en/common.json";
import enEnums from "@/i18n/messages/en/enums.json";
import enPatterns from "@/i18n/messages/en/patterns.json";
import enSettings from "@/i18n/messages/en/settings.json";
import enTable from "@/i18n/messages/en/table.json";
import enValidation from "@/i18n/messages/en/validation.json";
import type { UserListRowDTO } from "@/lib/validators/users";

const mocks = vi.hoisted(() => ({
  listUsersAction: vi.fn(),
  inviteUserAction: vi.fn(),
  changeUserRoleAction: vi.fn(),
  revokeUserInvitationAction: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("../actions", () => ({
  listUsersAction: mocks.listUsersAction,
  inviteUserAction: mocks.inviteUserAction,
  changeUserRoleAction: mocks.changeUserRoleAction,
  revokeUserInvitationAction: mocks.revokeUserInvitationAction,
}));
vi.mock("@/features/preferences/actions", () => ({ setPreferenceAction: vi.fn() }));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import { UsersTable } from "./users-table";

const owner: UserListRowDTO = {
  id: "usr_owner",
  name: "Ana Pérez",
  email: "ana@wedevs.dev",
  imageUrl: null,
  role: "OWNER",
  status: "ACTIVE",
  createdAt: "2026-01-10T12:00:00.000Z",
};
const invited: UserListRowDTO = {
  id: "uinv_0001",
  name: null,
  email: "new@wedevs.dev",
  imageUrl: null,
  role: "ADMIN",
  status: "INVITED",
  createdAt: "2026-10-01T12:00:00.000Z",
};

function renderTable() {
  return render(
    <NextIntlClientProvider
      locale="en"
      timeZone="America/Caracas"
      messages={{
        common: enCommon,
        enums: enEnums,
        patterns: enPatterns,
        settings: enSettings,
        table: enTable,
        validation: enValidation,
      }}
    >
      <NuqsTestingAdapter>
        <UsersTable initialRows={[owner, invited]} initialTotal={2} />
      </NuqsTestingAdapter>
    </NextIntlClientProvider>,
  );
}

const rowOf = (text: string) => screen.getAllByText(text)[0]!.closest("tr")!;

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listUsersAction.mockResolvedValue({
    ok: true,
    data: { items: [owner, invited], total: 2, page: 1, pageSize: 25, pageCount: 1 },
  });
});

describe("UsersTable (PRD §8.15 Usuarios)", () => {
  it("lists users and pending invitations with role and status", () => {
    renderTable();
    const ownerRow = rowOf("Ana Pérez");
    expect(ownerRow).toHaveTextContent("ana@wedevs.dev");
    expect(ownerRow).toHaveTextContent("Owner");
    expect(ownerRow).toHaveTextContent("Active");
    const invitedRow = rowOf("new@wedevs.dev");
    expect(invitedRow).toHaveTextContent("Admin");
    expect(invitedRow).toHaveTextContent("Invited");
    expect(mocks.listUsersAction).not.toHaveBeenCalled();
  });

  it("changes a role and shows the last-Owner message when refused", async () => {
    const user = userEvent.setup();
    mocks.changeUserRoleAction.mockResolvedValue({
      ok: false,
      error: { code: "INTEGRITY_LOCK", message: "settings.users.errors.lastOwner" },
    });
    renderTable();
    await user.click(
      within(rowOf("Ana Pérez")).getByRole("combobox", { name: "Role of Ana Pérez" }),
    );
    await user.click(await screen.findByRole("option", { name: "Admin" }));
    expect(mocks.changeUserRoleAction).toHaveBeenCalledWith({ userId: "usr_owner", role: "ADMIN" });
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(enSettings.users.errors.lastOwner),
    );
  });

  it("invites a person by e-mail with a role (Clerk invitation)", async () => {
    const user = userEvent.setup();
    mocks.inviteUserAction.mockResolvedValue({ ok: true, data: { ...invited, email: "x@y.dev" } });
    renderTable();
    await user.click(screen.getByRole("button", { name: "Invite user" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("E-mail"), "x@y.dev");
    await user.click(within(dialog).getByRole("button", { name: "Send invitation" }));
    await waitFor(() =>
      expect(mocks.inviteUserAction).toHaveBeenCalledWith({ email: "x@y.dev", role: "ADMIN" }),
    );
    expect(mocks.toast.success).toHaveBeenCalledWith("Invitation sent to x@y.dev");
    await waitFor(() => expect(mocks.listUsersAction).toHaveBeenCalled());
  });

  it("puts the taken e-mail message on the field", async () => {
    const user = userEvent.setup();
    mocks.inviteUserAction.mockResolvedValue({
      ok: false,
      error: {
        code: "CONFLICT",
        message: "common.errors.CONFLICT",
        fieldErrors: { email: ["settings.users.errors.emailTaken"] },
      },
    });
    renderTable();
    await user.click(screen.getByRole("button", { name: "Invite user" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("E-mail"), "ana@wedevs.dev");
    await user.click(within(dialog).getByRole("button", { name: "Send invitation" }));
    expect(await within(dialog).findByText(enSettings.users.errors.emailTaken)).toBeInTheDocument();
  });

  it("revokes a pending invitation", async () => {
    const user = userEvent.setup();
    mocks.revokeUserInvitationAction.mockResolvedValue({
      ok: true,
      data: { invitationId: "uinv_0001" },
    });
    renderTable();
    await user.click(
      within(rowOf("new@wedevs.dev")).getByRole("button", {
        name: "Revoke the invitation of new@wedevs.dev",
      }),
    );
    expect(mocks.revokeUserInvitationAction).toHaveBeenCalledWith({ invitationId: "uinv_0001" });
  });
});
