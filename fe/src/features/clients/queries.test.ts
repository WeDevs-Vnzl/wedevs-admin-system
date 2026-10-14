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
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("OWNER"));
    // Seeded FAC-0001..0003 of Kairos: 1392.00 + 500.00 + 928.00.
    expect((await getClientFinancials("cli_kairos")).totalInvoicedUsd).toBe("2820.00");
    expect((await getClientsOverview()).recentlyCreated.length).toBeGreaterThan(0);
  });

  it("throws a NOT_FOUND ServiceError so the page can call notFound()", async () => {
    await expect(getClient("cli_nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getClient("cli_nope")).rejects.toBeInstanceOf(ServiceError);
  });
});

// The financial summary is read only by finance roles (`canSeeFinancials`), like the project one.
describe("getClientFinancials gate", () => {
  it.each(["MEMBER", "VIEWER"] as const)("%s is FORBIDDEN", async (role) => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser(role));
    await expect(getClientFinancials("cli_kairos")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it.each(["OWNER", "ADMIN"] as const)("%s reads the summary", async (role) => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser(role));
    expect((await getClientFinancials("cli_kairos")).totalInvoicedUsd).toBe("2820.00");
  });
});
