import { useTranslations } from "next-intl";
import { EmptyState } from "@/components/patterns/empty-state";

// Finance tabs of client and project detail pages (PRD §8.2, §8.3). Until H1-B3 builds them, each tab shows
// this empty state; H1-B3 replaces the slot with the real tab content.
export type FinanceTabKind = "billing" | "invoices" | "payments" | "expenses";

export function FinanceTabSlot({ kind }: { kind: FinanceTabKind }) {
  const t = useTranslations("patterns.financeSlot");

  return <EmptyState title={t(`${kind}.title`)} description={t(`${kind}.description`)} />;
}
