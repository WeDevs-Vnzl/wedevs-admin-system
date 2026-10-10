import { FileQuestion } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { EmptyState } from "@/components/patterns/empty-state";
import { Button } from "@/components/ui/button";

// The not-found content shared by the page outside the shell (`src/app/not-found.tsx`) and the one inside it
// (`src/app/(app)/not-found.tsx`). It only links to the dashboard, which both layouts can reach.
export async function NotFoundContent() {
  const t = await getTranslations("common.notFound");

  return (
    <EmptyState
      icon={FileQuestion}
      title={t("title")}
      description={t("description")}
      action={
        <Button asChild>
          <Link href="/dashboard">{t("back")}</Link>
        </Button>
      }
    />
  );
}
