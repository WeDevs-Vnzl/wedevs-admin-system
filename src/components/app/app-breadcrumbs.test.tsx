import { act, render, screen, within } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
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

  // D2 (wave 5 Tester): the separator <li> sat inside the item <li>; the HTML parser closes the outer item, so the
  // server markup no longer matched the client tree and React threw hydration error #418 on every shell page.
  it("keeps separators as siblings of the items, never nested inside an <li>", () => {
    const { container } = renderAt("/settings/preferences");
    expect(container.querySelectorAll("li li")).toHaveLength(0);
    expect(container.querySelectorAll("ol > li")).toHaveLength(5);
  });

  it("hydrates the server markup without a mismatch", async () => {
    mocks.pathname = "/settings/preferences";
    const tree = (
      <NextIntlClientProvider
        locale="es"
        messages={{ common: esCommon, nav: esNav, settings: esSettings, shell: esShell }}
      >
        <AppBreadcrumbs />
      </NextIntlClientProvider>
    );
    const host = document.createElement("div");
    host.innerHTML = renderToString(tree);
    document.body.appendChild(host);

    const problems: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => problems.push(args));
    await act(async () => {
      hydrateRoot(host, tree, { onRecoverableError: (error) => problems.push(error) });
    });
    spy.mockRestore();
    host.remove();

    expect(problems).toEqual([]);
  });
});
