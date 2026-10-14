import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/patterns/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ActivityFeed } from "@/features/activity/components/activity-feed";
import {
  ActivityExportButton,
  ActivityFilters,
} from "@/features/activity/components/activity-filters";
import { ActivityStats } from "@/features/activity/components/activity-stats";
import { activityFilterFromSearchParams, getActivityPage } from "@/features/activity/queries";

type ActivityPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata() {
  const t = await getTranslations("activity.page");
  return { title: t("title") };
}

// `/activity` (wireframe 4.7): Owner and Admin only. Member and Viewer get the in-shell not-found page (C13).
export default async function ActivityPage({ searchParams }: ActivityPageProps) {
  const data = await getActivityPage(activityFilterFromSearchParams(await searchParams));
  if (!data) notFound();
  const t = await getTranslations("activity.page");
  const { filter, feed, stats, actors } = data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        count={feed.total}
        actions={<ActivityExportButton filter={filter} />}
      />
      <ActivityStats total={stats.total} today={stats.today} users={stats.users} />
      <ActivityFilters actors={actors} />
      {/* The feed rows are flat; the card gives them a surface over the page background. */}
      <Card className="rounded-2xl">
        <CardContent>
          <ActivityFeed key={JSON.stringify(filter)} initial={feed} filter={filter} />
        </CardContent>
      </Card>
    </div>
  );
}
