import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/messages/en/common.json";
import enNav from "@/i18n/messages/en/nav.json";
import enSettings from "@/i18n/messages/en/settings.json";
import enShell from "@/i18n/messages/en/shell.json";
import esCommon from "@/i18n/messages/es/common.json";
import esNav from "@/i18n/messages/es/nav.json";
import esSettings from "@/i18n/messages/es/settings.json";
import esShell from "@/i18n/messages/es/shell.json";
import { AppBreadcrumbs } from "./app-breadcrumbs";

const mocks = vi.hoisted(() => ({ pathname: "/dashboard" }));

vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));

function renderAt(pathname: string, locale: "es" | "en" = "es") {
  mocks.pathname = pathname;
  const messages =
    locale === "es"
      ? { common: esCommon, nav: esNav, settings: esSettings, shell: esShell }
      : { common: enCommon, nav: enNav, settings: enSettings, shell: enShell };
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <AppBreadcrumbs />
    </NextIntlClientProvider>,
  );
}

describe("AppBreadcrumbs", () => {
  beforeEach(() => {
    mocks.pathname = "/dashboard";
  });

  it("labels the settings section from settings.nav (m1)", () => {
    renderAt("/settings/preferences");
    expect(screen.getByRole("link", { name: "Configuración" })).toHaveAttribute("href", "/settings");
    expect(screen.getByText("Preferencias")).toHaveAttribute("aria-current", "page");
    const trail = screen.getByRole("navigation", { name: esShell.breadcrumbs.label });
    expect(within(trail).getByRole("link", { name: esCommon.app.name })).toBeInTheDocument();
  });

  it("keeps unknown segments as they appear in the URL", () => {
    renderAt("/clients/cli_123", "en");
    expect(screen.getByText("cli_123", { selector: "[aria-current='page']" })).toBeInTheDocument();
  });
});
