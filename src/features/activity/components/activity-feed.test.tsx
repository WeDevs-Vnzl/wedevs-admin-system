import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enActivity from "@/i18n/messages/en/activity.json";
import enEnums from "@/i18n/messages/en/enums.json";
import esActivity from "@/i18n/messages/es/activity.json";
import esEnums from "@/i18n/messages/es/enums.json";
import type { ActivityListRowDTO } from "@/lib/validators/activity";

const actions = vi.hoisted(() => ({ listActivityAction: vi.fn() }));
vi.mock("../actions", () => actions);

import { ActivityFeed, groupActivityByDay } from "./activity-feed";

function entry(overrides: Partial<ActivityListRowDTO> = {}): ActivityListRowDTO {
  return {
    id: "act_0001",
    actor: { type: "USER", id: "usr_ana", name: "Ana Torres", imageUrl: null },
    action: "UPDATE",
    entityType: "CLIENT",
    entityId: "cli_kairos",
    entityLabel: "Kairos Studio",
    changes: { status: ["PROSPECTO", "ACTIVO"] },
    metadata: null,
    ip: "192.0.2.14",
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0 Safari/537.36",
    createdAt: "2026-10-09T15:00:00.000Z",
    ...overrides,
  };
}

function wrap(ui: React.ReactNode, locale: "es" | "en" = "es") {
  const messages =
    locale === "es"
      ? { activity: esActivity, enums: esEnums }
      : { activity: enActivity, enums: enEnums };
  return render(
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="America/Caracas">
      {ui}
    </NextIntlClientProvider>,
  );
}

const page = (
  items: ActivityListRowDTO[],
  extra: Partial<{ page: number; pageCount: number }> = {},
) => ({
  items,
  total: items.length,
  page: extra.page ?? 1,
  pageSize: 25,
  pageCount: extra.pageCount ?? 1,
});

beforeEach(() => {
  actions.listActivityAction.mockReset();
});

describe("groupActivityByDay", () => {
  it("groups by the Caracas calendar day, keeping the newest-first order", () => {
    const groups = groupActivityByDay([
      entry({ id: "a", createdAt: "2026-10-08T05:00:00.000Z" }), // 01:00 on the 8th in Caracas
      entry({ id: "b", createdAt: "2026-10-08T02:30:00.000Z" }), // 22:30 on the 7th in Caracas
      entry({ id: "c", createdAt: "2026-10-07T15:00:00.000Z" }), // 11:00 on the 7th in Caracas
    ]);
    expect(groups.map((group) => group.day)).toEqual(["2026-10-08", "2026-10-07"]);
    expect(groups[1]!.items.map((item) => item.id)).toEqual(["b", "c"]);
  });
});

describe("ActivityFeed", () => {
  it("renders the day heading and the Caracas clock time in ES", () => {
    wrap(
      <ActivityFeed
        initial={page([entry({ id: "b", createdAt: "2026-10-08T02:30:00.000Z" })])}
        filter={{}}
      />,
    );
    expect(screen.getByRole("heading", { name: "7 de octubre de 2026" })).toBeInTheDocument();
    expect(screen.getByText("22:30")).toHaveAttribute("datetime", "2026-10-08T02:30:00.000Z");
  });

  it("labels system and public actors, and links the record only when it has a route", () => {
    wrap(
      <ActivityFeed
        initial={page([
          entry({
            id: "s",
            actor: { type: "SYSTEM", id: null, name: null, imageUrl: null },
            action: "SYSTEM_JOB",
          }),
          entry({
            id: "p",
            actor: { type: "PUBLIC", id: null, name: null, imageUrl: null },
            action: "PORTAL_ACCESS",
            entityType: "DOCUMENT",
            entityId: "doc_nda",
            entityLabel: "NDA",
          }),
          entry({ id: "t", entityType: "TAG", entityId: "tag_vip", entityLabel: "VIP" }),
        ])}
        filter={{}}
      />,
    );
    expect(screen.getByText("Sistema")).toBeInTheDocument();
    expect(screen.getByText("Portal público")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "NDA" })).toHaveAttribute("href", "/documents/doc_nda");
    expect(screen.getByText("VIP").closest("a")).toBeNull();
  });

  it("has no edit or delete control on any entry (HU-29 CA2)", () => {
    wrap(<ActivityFeed initial={page([entry()])} filter={{}} />);
    expect(screen.queryByRole("button", { name: /editar|eliminar|edit|delete/i })).toBeNull();
  });

  it("loads the next page through the read action and appends it", async () => {
    actions.listActivityAction.mockResolvedValue({
      ok: true,
      data: page([entry({ id: "act_0002", entityLabel: "Página de lote dos" })], {
        page: 2,
        pageCount: 2,
      }),
    });
    wrap(
      <ActivityFeed
        initial={page([entry({ id: "act_0001" })], { pageCount: 2 })}
        filter={{ action: ["UPDATE"] }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    await waitFor(() => expect(screen.getByText("Página de lote dos")).toBeInTheDocument());
    expect(actions.listActivityAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: ["UPDATE"], page: 2, pageSize: 25 }),
    );
    expect(screen.queryByRole("button", { name: "Cargar más" })).toBeNull();
  });

  it("shows an error and keeps the list when loading more fails", async () => {
    actions.listActivityAction.mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL", message: "common.errors.INTERNAL" },
    });
    wrap(<ActivityFeed initial={page([entry()], { pageCount: 2 })} filter={{}} />);
    fireEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo cargar más actividad");
    expect(screen.getByText("Kairos Studio")).toBeInTheDocument();
  });

  it("renders the empty state when nothing matches", () => {
    wrap(<ActivityFeed initial={page([])} filter={{}} />);
    expect(screen.getByText("Sin actividad")).toBeInTheDocument();
  });

  it("renders in EN", () => {
    wrap(
      <ActivityFeed
        initial={page([entry({ id: "b", createdAt: "2026-10-08T02:30:00.000Z" })], {
          pageCount: 2,
        })}
        filter={{}}
      />,
      "en",
    );
    expect(screen.getByRole("heading", { name: "October 7, 2026" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument();
    expect(screen.getByText("Updated Kairos Studio")).toBeInTheDocument();
  });
});
