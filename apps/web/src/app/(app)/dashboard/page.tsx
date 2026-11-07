import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { DashboardView, type DayPart } from "@/features/dashboard/components/dashboard-view";
import { parseDashboardPeriod } from "@/features/dashboard/period";
import { getDashboardForPeriod } from "@/features/dashboard/queries";
import { BUSINESS_TIME_ZONE, todayInCaracas } from "@/lib/dates";
import { canSeeFinancials } from "@/server/auth/permissions";
import { requireSessionUser } from "@/server/auth/session";

type DashboardPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard.page");
  return { title: t("title") };
}

function dayPart(now: Date): DayPart {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: BUSINESS_TIME_ZONE,
    }).format(now),
  );
  if (hour < 12) return "morning";
  return hour < 19 ? "afternoon" : "evening";
}

// `/dashboard` (PRD §8.1, wireframe 4.2): every figure in USD from stored snapshots, computed by the BE for the
// period in the URL. Member and Viewer get the version without financial data (§11): the BE zeroes it and the view
// hides it (`canSeeFinancials`, cosmetic only).
export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const user = await requireSessionUser();
  const period = parseDashboardPeriod((await searchParams).period);
  const result = await getDashboardForPeriod(period);
  if (!result.ok) throw new Error(result.error.code);
  const now = new Date();

  return (
    <DashboardView
      dashboard={result.data}
      period={period}
      showFinancials={canSeeFinancials(user)}
      userName={user.name.split(" ")[0] ?? user.name}
      dayPart={dayPart(now)}
      today={todayInCaracas(now)}
    />
  );
}
