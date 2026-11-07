import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { createTranslator } from "next-intl";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import enEnums from "@/i18n/messages/en/enums.json";
import enInvoices from "@/i18n/messages/en/invoices.json";
import enPatterns from "@/i18n/messages/en/patterns.json";
import enCommon from "@/i18n/messages/en/common.json";

const mocks = vi.hoisted(() => ({ getServerApi: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", () => ({ getServerApi: mocks.getServerApi }));

const messages = { invoices: enInvoices, enums: enEnums, patterns: enPatterns, common: enCommon };
vi.mock("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) =>
    createTranslator({ locale: "en", messages, namespace: namespace as "invoices" }),
}));

import { errorEnvelope, mockApi } from "@/lib/api/testing";
import { invoiceListItem, invoicePage } from "../test-data";
import { RelatedInvoicesTab } from "./related-invoices-tab";

async function renderTab(props: ComponentProps<typeof RelatedInvoicesTab>) {
  const element = await RelatedInvoicesTab(props);
  return render(
    <NextIntlClientProvider locale="en" timeZone="America/Caracas" messages={messages}>
      {element}
    </NextIntlClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("RelatedInvoicesTab (frozen: { filter, newHref })", () => {
  it("lists the client's invoices, sending the client as the clientId facet", async () => {
    const mocked = mockApi({
      "GET /api/v1/invoices": {
        body: invoicePage([invoiceListItem({ id: "inv_7", invoiceNumber: "00007" })]),
      },
    });
    mocks.getServerApi.mockResolvedValue(mocked.api);

    await renderTab({ filter: { clientId: "cli_1" }, newHref: "/invoices/new?clientId=cli_1" });

    expect(mocked.calls[0]?.search.getAll("clientId")).toEqual(["cli_1"]);
    expect(mocked.calls[0]?.search.get("sort")).toBe("issueDate:desc");
    expect(screen.getByRole("link", { name: "00007" })).toHaveAttribute("href", "/invoices/inv_7");
  });

  it("sends the project as the projectId facet", async () => {
    const mocked = mockApi({ "GET /api/v1/invoices": { body: invoicePage([]) } });
    mocks.getServerApi.mockResolvedValue(mocked.api);
    await renderTab({ filter: { projectId: "prj_1" } });
    expect(mocked.calls[0]?.search.getAll("projectId")).toEqual(["prj_1"]);
  });

  it("renders no rows (and no data) when the BE refuses the role", async () => {
    mocks.getServerApi.mockResolvedValue(
      mockApi({ "GET /api/v1/invoices": errorEnvelope("FORBIDDEN") }).api,
    );
    await renderTab({ filter: { clientId: "cli_1" } });
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("holds the frozen props (type-level)", () => {
    expectTypeOf<ComponentProps<typeof RelatedInvoicesTab>>().toEqualTypeOf<{
      filter: { clientId: string } | { projectId: string };
      newHref?: string;
    }>();
  });
});
