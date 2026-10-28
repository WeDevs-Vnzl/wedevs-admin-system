import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import enActivity from "@/i18n/messages/en/activity.json";
import enEnums from "@/i18n/messages/en/enums.json";
import esActivity from "@/i18n/messages/es/activity.json";
import esEnums from "@/i18n/messages/es/enums.json";
import type { ActivityListRowDTO } from "@/lib/validators/activity";
import { ActivityDetailSheet, browserKey, maskIp } from "./activity-detail-sheet";

const row: ActivityListRowDTO = {
  id: "act_0042",
  actor: { type: "USER", id: "usr_ana", name: "Ana Torres", imageUrl: null },
  action: "STATUS_CHANGE",
  entityType: "PROJECT",
  entityId: "prj_portal",
  entityLabel: "Portal de clientes",
  changes: { status: ["PROPUESTA", "EN_CURSO"] },
  metadata: null,
  ip: "192.0.2.14",
  userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0",
  createdAt: "2026-10-09T15:00:00.000Z",
};

function wrap(ui: React.ReactNode, locale: "es" | "en" = "es") {
  const messages =
    locale === "es"
      ? { activity: esActivity, enums: esEnums }
      : { activity: enActivity, enums: enEnums };
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("maskIp", () => {
  it("keeps the first three IPv4 octets and masks the last one", () => {
    expect(maskIp("192.0.2.14")).toBe("192.0.2.•••");
    expect(maskIp("198.51.100.7")).toBe("198.51.100.•••");
  });

  it("masks the last group of an IPv6 address and passes nothing through", () => {
    expect(maskIp("2001:db8:85a3:0:0:8a2e:370:7334")).toBe("2001:db8:85a3:•••");
    expect(maskIp(null)).toBeNull();
  });
});

describe("browserKey", () => {
  it("names the browser family, Edge and Firefox before Chrome before Safari", () => {
    expect(browserKey(null)).toBeNull();
    expect(browserKey("Mozilla/5.0 Chrome/120 Safari/537 Edg/120")).toBe("edge");
    expect(browserKey("Mozilla/5.0 Gecko Firefox/120.0")).toBe("firefox");
    expect(browserKey("Mozilla/5.0 Chrome/120 Safari/537")).toBe("chrome");
    expect(browserKey("Mozilla/5.0 Version/17 Safari/605")).toBe("safari");
    expect(browserKey("curl/8")).toBe("other");
  });
});

describe("ActivityDetailSheet", () => {
  it("shows the diff, the masked IP, the browser, the event id, the entity link and the immutability note", () => {
    wrap(<ActivityDetailSheet entry={row} open onOpenChange={vi.fn()} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("192.0.2.•••")).toBeInTheDocument();
    expect(screen.queryByText("192.0.2.14")).toBeNull();
    expect(screen.getByText("Firefox")).toBeInTheDocument();
    expect(screen.getByText("act_0042")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Abrir registro/ })).toHaveAttribute(
      "href",
      "/projects/prj_portal",
    );
    expect(screen.getByText(/es inmutable/)).toBeInTheDocument();
    expect(screen.getByText("Propuesta")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /editar|eliminar/i })).toBeNull();
  });

  it("omits the link when the record has no route, and says so when nothing changed", () => {
    wrap(
      <ActivityDetailSheet
        entry={{ ...row, entityType: "TAG", ip: null, userAgent: null, changes: null }}
        open
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Este evento no registra cambios de campos.")).toBeInTheDocument();
    expect(screen.queryByText(/192\.0\.2/)).toBeNull();
  });

  it("renders in EN", () => {
    wrap(<ActivityDetailSheet entry={row} open onOpenChange={vi.fn()} />, "en");
    expect(
      screen.getByRole("heading", { name: "Changed the status of Portal de clientes" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open record/ })).toBeInTheDocument();
  });

  it("keeps rendering the last entry while it closes", () => {
    const messages = { activity: esActivity, enums: esEnums };
    const ui = (entry: ActivityListRowDTO | null, open: boolean) => (
      <NextIntlClientProvider locale="es" messages={messages}>
        <ActivityDetailSheet entry={entry} open={open} onOpenChange={vi.fn()} />
      </NextIntlClientProvider>
    );
    const { rerender } = render(ui(row, true));
    expect(screen.getByText("act_0042")).toBeInTheDocument();
    // The parent clears the entry as the sheet closes; the exit animation still shows the last one.
    rerender(ui(null, true));
    expect(screen.getByText("act_0042")).toBeInTheDocument();
  });
});
