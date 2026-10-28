import { Calendar, Users, Zap } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { StatCard } from "@/components/patterns/stat-card";

/** The three stat cards of `/activity` (wireframe 4.7). Server-rendered from the page data. */
export async function ActivityStats({
  total,
  today,
  users,
}: {
  total: number;
  today: number;
  users: number;
}) {
  const t = await getTranslations("activity.stats");
  return (
    <section aria-label={t("total")} className="grid gap-4 sm:grid-cols-3">
      <StatCard label={t("total")} value={total} hint={t("totalHint")} icon={Zap} />
      <StatCard label={t("today")} value={today} hint={t("todayHint")} icon={Calendar} />
      <StatCard label={t("users")} value={users} hint={t("usersHint")} icon={Users} />
    </section>
  );
}
