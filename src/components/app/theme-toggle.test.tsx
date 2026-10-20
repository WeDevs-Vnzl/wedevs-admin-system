import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/messages/en/common.json";
import enShell from "@/i18n/messages/en/shell.json";
import { setPreferenceAction } from "@/features/preferences/actions";
import { ThemeToggle } from "./theme-toggle";

const mocks = vi.hoisted(() => ({ setTheme: vi.fn(), toast: { error: vi.fn() } }));

vi.mock("@/features/preferences/actions", () => ({ setPreferenceAction: vi.fn() }));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "light", setTheme: mocks.setTheme }) }));
vi.mock("sonner", () => ({ toast: mocks.toast }));

function renderToggle() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ shell: enShell, common: enCommon }}>
      <ThemeToggle />
    </NextIntlClientProvider>,
  );
}

describe("ThemeToggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(setPreferenceAction).mockResolvedValue({ ok: true, data: {} } as never);
  });

  it("applies the theme and saves it as the theme preference (M3)", async () => {
    const user = userEvent.setup();
    renderToggle();

    await user.click(screen.getByRole("button", { name: enShell.themeToggle.label }));
    await user.click(await screen.findByRole("menuitemradio", { name: enShell.themeToggle.dark }));

    expect(mocks.setTheme).toHaveBeenCalledWith("dark");
    await waitFor(() =>
      expect(setPreferenceAction).toHaveBeenCalledWith({ key: "theme", value: "dark" }),
    );
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it("keeps the local theme and shows the error when the save fails (M3)", async () => {
    vi.mocked(setPreferenceAction).mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL", message: "common.errors.INTERNAL" },
    } as never);
    const user = userEvent.setup();
    renderToggle();

    await user.click(screen.getByRole("button", { name: enShell.themeToggle.label }));
    await user.click(
      await screen.findByRole("menuitemradio", { name: enShell.themeToggle.system }),
    );

    expect(mocks.setTheme).toHaveBeenCalledWith("system");
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(enCommon.errors.INTERNAL));
  });
});
