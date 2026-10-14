import { getTranslations } from "next-intl/server";
import { SectionCard } from "@/components/patterns/section-card";
import type { EntityType } from "@/lib/validators/enums";
import { getEntityActivity } from "../queries";
import { ActivityFeed } from "./activity-feed";

/**
 * The *Actividad* tab of a record: the same timeline and diffs as `/activity`, filtered to one record. Renders
 * nothing when the signed-in user cannot read the activity log (Member, Viewer).
 */
export async function EntityActivityTab({ entity }: { entity: { type: EntityType; id: string } }) {
  const data = await getEntityActivity(entity);
  if (!data) return null;
  const t = await getTranslations("activity.tab");

  return (
    <SectionCard heading title={t("title")}>
      <ActivityFeed initial={data} filter={{ entityType: [entity.type], entityId: entity.id }} />
    </SectionCard>
  );
}
