import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn(), requireSessionUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/mocks/session", () => ({ getMockSessionUser: session.getMockSessionUser }));
// The page reads the role through requireSessionUser (BE session); the feature reads data via the mock context.
vi.mock("@/server/auth/session", () => ({ requireSessionUser: session.requireSessionUser }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));

import { makeSessionUser } from "@/mocks/test-helpers";
import type { DashboardViewProps } from "@/features/dashboard/components/dashboard-view";
import DashboardPage from "./page";

const render = async (search: Record<string, string> = {}) =>
  (await DashboardPage({
    searchParams: Promise.resolve(search),
  })) as ReactElement<DashboardViewProps>;

/** Signs the same user in for the page (BE session) and for the mock service context. */
const signIn = (user: ReturnType<typeof makeSessionUser>) => {
  session.requireSessionUser.mockResolvedValue(user);
  session.getMockSessionUser.mockResolvedValue(user);
};

beforeEach(() => {
  session.getMockSessionUser.mockReset();
  session.requireSessionUser.mockReset();
});

describe("/dashboard page", () => {
  it("reads the period from the URL and aggregates the cards over it", async () => {
    signIn(makeSessionUser("OWNER", { name: "Andrés Molina" }));
    const month = (await render()).props;
    const year = (await render({ period: "year" })).props;

    expect(month.period).toBe("month");
    expect(year.period).toBe("year");
    expect(month.showFinancials).toBe(true);
    expect(month.userName).toBe("Andrés");
    expect(month.kpis).toEqual(month.dashboard.kpis);
    expect(year.kpis).toHaveLength(8);
    // The year sums every month to date, so it never collects less than the month alone.
    const collected = (props: DashboardViewProps) =>
      Number(props.kpis.find((card) => card.id === "COLLECTED_MONTH")!.value);
    expect(collected(year)).toBeGreaterThanOrEqual(collected(month));
  });

  it("tells the view to hide financial data from Member and Viewer", async () => {
    signIn(makeSessionUser("VIEWER"));
    const { showFinancials } = (await render({ period: "junk" })).props;
    expect(showFinancials).toBe(false);
  });
});
