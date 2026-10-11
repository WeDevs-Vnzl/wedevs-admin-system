import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import enActivity from "@/i18n/messages/en/activity.json";
import enEnums from "@/i18n/messages/en/enums.json";
import esActivity from "@/i18n/messages/es/activity.json";
import esEnums from "@/i18n/messages/es/enums.json";
import type { ActivityListRowDTO } from "@/lib/validators/activity";

const queries = vi.hoisted(() => ({ getEntityActivity: vi.fn() }));
vi.mock("../queries", () => queries);
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => (key === "title" ? "Actividad" : key)),
}));
vi.mock("../actions", () => ({ listActivityAction: vi.fn() }));

import { EntityActivityTab } from "./entity-activity-tab";

const entry: ActivityListRowDTO = {
  id: "act_0007",
  actor: { type: "SYSTEM", id: null, name: null, imageUrl: null },
  action: "SYSTEM_JOB",
  entityType: "CLIENT",
  entityId: "cli_kairos",
  entityLabel: "Kairos Studio",
  changes: null,
  metadata: null,
  ip: null,
  userAgent: null,
  createdAt: "2026-10-09T15:00:00.000Z",
};

describe("EntityActivityTab", () => {
  it("renders nothing for a user without access (queries return null)", async () => {
    queries.getEntityActivity.mockResolvedValue(null);
    const { container } = render(
      <NextIntlClientProvider locale="es" messages={{ activity: esActivity, enums: esEnums }}>
        {await EntityActivityTab({ entity: { type: "CLIENT", id: "cli_kairos" } })}
      </NextIntlClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
    expect(queries.getEntityActivity).toHaveBeenCalledWith({ type: "CLIENT", id: "cli_kairos" });
  });

  it("renders the record's own timeline with its title", async () => {
    queries.getEntityActivity.mockResolvedValue({
      items: [entry],
      total: 1,
      page: 1,
      pageSize: 25,
      pageCount: 1,
    });
    render(
      <NextIntlClientProvider locale="en" messages={{ activity: enActivity, enums: enEnums }}>
        {await EntityActivityTab({ entity: { type: "CLIENT", id: "cli_kairos" } })}
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("heading", { name: "Actividad" })).toBeInTheDocument();
    expect(screen.getByText("System")).toBeInTheDocument();
    expect(screen.getByText("Kairos Studio")).toBeInTheDocument();
  });
});
