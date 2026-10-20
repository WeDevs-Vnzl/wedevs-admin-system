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

import { KPI_ID_VALUES, REPORT_ID_VALUES } from "@/lib/validators/reports";
import { makeSessionUser } from "@/mocks/test-helpers";
import ReportPage from "./page";

const props = (report: string, search: Record<string, string> = {}) => ({
  params: Promise.resolve({ report }),
  searchParams: Promise.resolve(search),
});
const slug = (id: string) => id.toLowerCase().replaceAll("_", "-");

beforeEach(() => {
  session.getMockSessionUser.mockReset();
  session.getMockSessionUser.mockResolvedValue(makeSessionUser("OWNER"));
});

describe("/reports/[report] page", () => {
  it.each([...REPORT_ID_VALUES, ...KPI_ID_VALUES])("opens %s from its slug", async (id) => {
    const element = await ReportPage(props(slug(id), { preset: "QUARTER" }));
    expect(element).toBeTruthy();
  });

  it("answers the in-shell notFound() for an unknown slug", async () => {
    await expect(ReportPage(props("profit"))).rejects.toThrow("NOT_FOUND_TEST");
  });

  it.each(["MEMBER", "VIEWER"] as const)("answers the in-shell notFound() for %s", async (role) => {
    session.getMockSessionUser.mockResolvedValue(makeSessionUser(role));
    await expect(ReportPage(props("taxes-registered"))).rejects.toThrow("NOT_FOUND_TEST");
  });
});
