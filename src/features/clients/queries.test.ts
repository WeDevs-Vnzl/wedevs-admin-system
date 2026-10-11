import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/mocks/session", () => session);

import { ServiceError } from "@/server/errors";
import { makeSessionUser } from "@/mocks/test-helpers";
import { getClient, getClientFinancials, getClientsOverview, listClients } from "./queries";

beforeEach(() => {
  session.getMockSessionUser.mockReset();
  session.getMockSessionUser.mockResolvedValue(makeSessionUser("MEMBER"));
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__wedevsMockState;
});

describe("clients queries", () => {
  it("lists with the contract defaults and parses URL-shaped input", async () => {
    const page = await listClients({ page: "2", pageSize: "25", status: "ACTIVO" });
    expect(page).toMatchObject({ page: 2, pageSize: 25 });
    expect(page.items.every((c) => c.status === "ACTIVO")).toBe(true);
    expect((await listClients()).page).toBe(1);
  });

  it("reads one client, its financials and the overview", async () => {
    expect((await getClient("cli_kairos")).tradeName).toBe("Kairos Studio");
    expect((await getClientFinancials("cli_kairos")).totalInvoicedUsd).toBe("0.00");
    expect((await getClientsOverview()).recentlyCreated.length).toBeGreaterThan(0);
  });

  it("throws a NOT_FOUND ServiceError so the page can call notFound()", async () => {
    await expect(getClient("cli_nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getClient("cli_nope")).rejects.toBeInstanceOf(ServiceError);
  });
});
