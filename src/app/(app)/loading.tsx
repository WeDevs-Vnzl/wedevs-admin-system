import { getTranslations } from "next-intl/server";
import { Skeleton } from "@/components/ui/skeleton";

// Skeleton shown while an (app) page streams; the shell stays rendered around it.
export default async function AppLoading() {
  const t = await getTranslations("common.states");

  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-6">
      <span className="sr-only">{t("loading")}</span>
      <Skeleton className="h-8 w-56" />
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-28 rounded-2xl" />
      </div>
      <Skeleton className="h-72 rounded-2xl" />
    </div>
  );
}
