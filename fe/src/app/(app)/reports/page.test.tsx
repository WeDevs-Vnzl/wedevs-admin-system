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
import ReportsPage from "./page";

const props = (search: Record<string, string> = {}) => ({ searchParams: Promise.resolve(search) });

beforeEach(() => {
  session.getMockSessionUser.mockReset();
});

describe("/reports page", () => {
  it.each(["OWNER", "ADMIN"] as const)(
    "renders for %s, reading the range from the URL",
    async (role) => {
      session.getMockSessionUser.mockResolvedValue(makeSessionUser(role));
      expect(
        await ReportsPage(props({ preset: "CUSTOM", from: "2026-01-01", to: "2026-03-31" })),
      ).toBeTruthy();
    },
  );

  it.each(["MEMBER", "VIEWER"] as const)("answers the in-shell notFound() for %s", async (role) => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser(role));
    await expect(ReportsPage(props())).rejects.toThrow("NOT_FOUND_TEST");
  });
});
