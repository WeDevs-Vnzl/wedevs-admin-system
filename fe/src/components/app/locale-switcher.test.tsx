import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import esCommon from "@/i18n/messages/es/common.json";
import esShell from "@/i18n/messages/es/shell.json";
import { setPreferenceAction } from "@/features/preferences/actions";
import { LocaleSwitcher } from "./locale-switcher";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@/features/preferences/actions", () => ({ setPreferenceAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: mocks.toast }));

function renderSwitcher() {
  return render(
    <NextIntlClientProvider locale="es" messages={{ shell: esShell, common: esCommon }}>
      <LocaleSwitcher />
    </NextIntlClientProvider>,
  );
}

describe("LocaleSwitcher", () => {
  beforeEach(() => {
    vi.mocked(setPreferenceAction).mockResolvedValue({ ok: true, data: {} } as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
    document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
  });

  it("saves the chosen language as the locale preference and refreshes (M3)", async () => {
    const user = userEvent.setup();
    renderSwitcher();

    await user.click(screen.getByRole("button", { name: esShell.localeSwitcher.label }));
    await user.click(await screen.findByRole("menuitemradio", { name: "English" }));

    await waitFor(() =>
      expect(setPreferenceAction).toHaveBeenCalledWith({ key: "locale", value: "en" }),
    );
    expect(document.cookie).toContain("NEXT_LOCALE=en");
    expect(mocks.refresh).toHaveBeenCalled();
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it("keeps the local language and shows the error when the save fails (M3)", async () => {
    vi.mocked(setPreferenceAction).mockResolvedValue({
      ok: false,
      error: { code: "UNAUTHENTICATED", message: "common.errors.UNAUTHENTICATED" },
    } as never);
    const user = userEvent.setup();
    renderSwitcher();

    await user.click(screen.getByRole("button", { name: esShell.localeSwitcher.label }));
    await user.click(await screen.findByRole("menuitemradio", { name: "English" }));

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(esCommon.errors.UNAUTHENTICATED),
    );
    expect(document.cookie).toContain("NEXT_LOCALE=en");
  });
});
