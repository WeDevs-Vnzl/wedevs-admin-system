import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enAuth from "@/i18n/messages/en/auth.json";
import enCommon from "@/i18n/messages/en/common.json";
import enEnums from "@/i18n/messages/en/enums.json";
import enMock from "@/i18n/messages/en/mock.json";
import enShell from "@/i18n/messages/en/shell.json";
import type { SessionUser } from "@/lib/auth/types";
import { UserMenu } from "./user-menu";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  signOut: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock("@clerk/nextjs", () => ({ useClerk: () => ({ signOut: mocks.signOut }) }));
vi.mock("@/features/session/actions", () => ({ resetMockDataAction: mocks.reset }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const messages = { shell: enShell, mock: enMock, auth: enAuth, common: enCommon, enums: enEnums };

const user: SessionUser = {
  id: "usr_owner",
  name: "Test User",
  email: "test.user@example.com",
  imageUrl: null,
  role: "OWNER",
  locale: "en",
  theme: "system",
};

function renderMenu() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <UserMenu user={user} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  mocks.push.mockReset();
  mocks.refresh.mockReset();
  mocks.signOut.mockReset();
  mocks.reset.mockReset();
});

describe("UserMenu", () => {
  it("has no role switch", async () => {
    const u = userEvent.setup();
    renderMenu();
    await u.click(screen.getByRole("button", { name: enShell.userMenu.label }));
    expect(screen.queryByText(/view as role/i)).toBeNull();
    expect(screen.getByText(enMock.reset.label)).toBeTruthy();
  });

  it("signs out through Clerk and redirects to /sign-in", async () => {
    const u = userEvent.setup();
    renderMenu();
    await u.click(screen.getByRole("button", { name: enShell.userMenu.label }));
    await u.click(screen.getByRole("menuitem", { name: enAuth.signOut }));
    expect(mocks.signOut).toHaveBeenCalledWith({ redirectUrl: "/sign-in" });
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("still resets the mock data through the action", async () => {
    mocks.reset.mockResolvedValue({ ok: true, data: { resetAt: "x" } });
    const u = userEvent.setup();
    renderMenu();
    await u.click(screen.getByRole("button", { name: enShell.userMenu.label }));
    await u.click(screen.getByRole("menuitem", { name: enMock.reset.label }));
    await u.click(screen.getByRole("button", { name: enMock.reset.confirm }));
    expect(mocks.reset).toHaveBeenCalledWith({});
  });
});
