// T10 phase B regression test (S14): the finance summaries are read only by finance roles (`canSeeFinancials`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/mocks/session", () => session);

import { makeSessionUser } from "@/mocks/test-helpers";
import { getProjectFinancials } from "@/features/projects/queries";

const PROJECT = "pry_kairos_web";

beforeEach(() => session.getMockSessionUser.mockReset());
afterEach(() => {
  delete (globalThis as Record<string, unknown>).__wedevsMockState;
});

describe("getProjectFinancials gate", () => {
  it.each(["MEMBER", "VIEWER"] as const)("%s is FORBIDDEN", async (role) => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser(role));
    await expect(getProjectFinancials(PROJECT)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it.each(["OWNER", "ADMIN"] as const)("%s reads the summary", async (role) => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser(role));
    const s = await getProjectFinancials(PROJECT);
    expect(s.projectId).toBe(PROJECT);
    expect(s.currency).toBe("USD");
  });
});
