import { Settings } from "lucide-react";
import { useTranslations } from "next-intl";
import { EmptyState } from "@/components/patterns/empty-state";

// Stand-in for the Configuración sections not built in Hito 1 B1 (their own batches replace it), so no nav
// link leads to a 404.
export function SectionPlaceholder() {
  const t = useTranslations("settings.placeholder");
  return <EmptyState icon={Settings} title={t("title")} description={t("description")} />;
}
