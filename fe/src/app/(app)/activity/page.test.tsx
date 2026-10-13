import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
const intl = vi.hoisted(() => ({ getTranslations: vi.fn(async () => (key: string) => key) }));
vi.mock("server-only", () => ({}));
vi.mock("@/mocks/session", () => session);
vi.mock("next-intl/server", () => intl);
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND_TEST");
  }),
}));

import { makeSessionUser } from "@/mocks/test-helpers";
import ActivityPage from "./page";

const params = (search: Record<string, string | string[]> = {}) => ({
  searchParams: Promise.resolve(search),
});

beforeEach(() => {
  session.getMockSessionUser.mockReset();
});

describe("/activity page", () => {
  it.each(["MEMBER", "VIEWER"] as const)("answers the in-shell notFound() for %s", async (role) => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser(role));
    await expect(ActivityPage(params())).rejects.toThrow("NOT_FOUND_TEST");
  });

  it("renders for Owner and Admin, reading the filter from the URL", async () => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser("ADMIN"));
    const element = await ActivityPage(params({ actorType: "SYSTEM", junk: "x" }));
    expect(element).toBeTruthy();
  });
});
