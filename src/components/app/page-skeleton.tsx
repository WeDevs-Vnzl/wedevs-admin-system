import { getTranslations } from "next-intl/server";
import { Skeleton } from "@/components/ui/skeleton";

// Skeleton shown while a shell page streams; the shell stays rendered around it. Used by the `loading.tsx` of the
// routes that fetch data, never by `app/(app)/loading.tsx`: a loading boundary above the catch-all
// `[...missing]/page.tsx` commits the response (HTTP 200) before `notFound()` runs, so unknown URLs would never
// answer 404 (D3).
export async function PageSkeleton() {
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
