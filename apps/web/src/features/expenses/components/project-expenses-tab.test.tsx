import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import esExpenses from "@/i18n/messages/es/expenses.json";
import esEnums from "@/i18n/messages/es/enums.json";
import esPatterns from "@/i18n/messages/es/patterns.json";
import { mockApi } from "@/lib/api/testing";
import { makeExpense, page } from "../test-fixtures";

const server = vi.hoisted(() => ({ getServerApi: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", () => server);
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  return {
    getTranslations: async () =>
      createTranslator({ locale: "es", messages: { expenses: esExpenses }, namespace: "expenses" }),
  };
});

import { ProjectExpensesTab } from "./project-expenses-tab";

beforeEach(() => server.getServerApi.mockReset());

describe("ProjectExpensesTab (frozen)", () => {
  it("lists the BE expenses charged to the project, newest first", async () => {
    const { api, calls } = mockApi({
      "GET /api/v1/expenses": {
        body: page([makeExpense({ id: "exp_9", code: "GAS-0009", amountUsd: "75.00" })]),
      },
    });
    server.getServerApi.mockResolvedValue(api);

    const tab = (await ProjectExpensesTab({
      projectId: "pry_1",
      newHref: "/expenses/new",
    })) as ReactElement;
    render(
      <NextIntlClientProvider
        locale="es"
        timeZone="America/Caracas"
        messages={{ expenses: esExpenses, enums: esEnums, patterns: esPatterns }}
      >
        {tab}
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole("link", { name: "GAS-0009" })).toHaveAttribute(
      "href",
      "/expenses/exp_9",
    );
    expect(calls[0]?.search.getAll("projectId")).toEqual(["pry_1"]);
    expect(calls[0]?.search.get("sort")).toBe("date:desc");
  });

  it("keeps the props the project page mounts (type-level)", () => {
    expectTypeOf(ProjectExpensesTab).parameter(0).toEqualTypeOf<{
      projectId: string;
      newHref?: string;
    }>();
  });
});
