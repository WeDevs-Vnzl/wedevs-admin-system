import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

type EmptyStatePatternProps = {
  icon?: LucideIcon;
  title: string;
  description?: string;
  // CTA such as "Nuevo cliente".
  action?: ReactNode;
  // Inside a card: no frame of its own (no card inside a card).
  embedded?: boolean;
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  embedded = false,
}: EmptyStatePatternProps) {
  return (
    <Empty className={embedded ? "border-0 p-6" : "rounded-2xl border"}>
      <EmptyHeader>
        {Icon ? (
          <EmptyMedia variant="icon">
            <Icon aria-hidden />
          </EmptyMedia>
        ) : null}
        <EmptyTitle>{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}
