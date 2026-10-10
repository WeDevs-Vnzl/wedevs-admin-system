import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enSettings from "@/i18n/messages/en/settings.json";
import esSettings from "@/i18n/messages/es/settings.json";
import { setPreferenceAction } from "@/features/preferences/actions";
import { PreferencesForm } from "./preferences-form";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  setTheme: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/features/preferences/actions", () => ({ setPreferenceAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "system", setTheme: mocks.setTheme }) }));
vi.mock("sonner", () => ({ toast: mocks.toast }));

const initial = { locale: "es", theme: "system", timezone: "America/Caracas" } as const;
const timezones = ["America/Caracas", "UTC", "Europe/Madrid"];

function renderForm(locale: "es" | "en" = "es") {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={{ settings: locale === "es" ? esSettings : enSettings }}
    >
      <PreferencesForm initial={initial} timezones={timezones} />
    </NextIntlClientProvider>,
  );
}

const saveButton = () => screen.getByRole("button", { name: "Guardar cambios" });

beforeAll(() => {
  // Radix Select measures its trigger; jsdom has no ResizeObserver (same stub as the data-table tests).
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  vi.mocked(setPreferenceAction).mockResolvedValue({ ok: true, data: {} } as never);
});

afterEach(() => {
  vi.clearAllMocks();
  document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
});

describe("PreferencesForm", () => {
  it("keeps Save disabled until a preference changes", () => {
    renderForm();
    expect(saveButton()).toBeDisabled();
  });

  it("saves the changed theme through the action and applies it", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByLabelText("Oscuro"));
    await user.click(saveButton());

    await waitFor(() =>
      expect(setPreferenceAction).toHaveBeenCalledWith({ key: "theme", value: "dark" }),
    );
    expect(setPreferenceAction).toHaveBeenCalledTimes(1);
    expect(mocks.setTheme).toHaveBeenCalledWith("dark");
    expect(mocks.toast.success).toHaveBeenCalledWith("Preferencias guardadas");
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("sets NEXT_LOCALE and refreshes when the language changes, saving only that key", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByLabelText("English"));
    await user.click(saveButton());

    await waitFor(() =>
      expect(setPreferenceAction).toHaveBeenCalledWith({ key: "locale", value: "en" }),
    );
    expect(setPreferenceAction).toHaveBeenCalledTimes(1);
    expect(document.cookie).toContain("NEXT_LOCALE=en");
    expect(mocks.setTheme).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("keeps the theme as it was and reports the error when the action fails", async () => {
    vi.mocked(setPreferenceAction).mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL", message: "boom" },
    } as never);
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByLabelText("Claro"));
    await user.click(saveButton());

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("No se pudieron guardar las preferencias"));
    expect(mocks.setTheme).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
