import { useId, type ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type SectionCardProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  // Form sections: exposes the card as a group named by its title, so a screen reader announces it with its fields.
  group?: boolean;
  // Columns taken on the two-column FormPage grid: 2 for wide content (rich text, link lists, multi-field
  // grids), 1 for compact sections. Unset leaves the card to its parent's layout (detail pages, overviews).
  span?: 1 | 2;
  // Detail tabs: the title is the tab's level-2 heading, as the bare `<h2>` the tabs had before.
  heading?: boolean;
  children: ReactNode;
};

// Titled section of a form or detail page (rounded card, ~16 px radius).
export function SectionCard({
  title,
  description,
  actions,
  group = false,
  span,
  heading = false,
  children,
}: SectionCardProps) {
  const titleId = useId();
  return (
    <Card
      className={cn("rounded-2xl", span === 2 && "md:col-span-2")}
      role={group ? "group" : undefined}
      aria-labelledby={group ? titleId : undefined}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle
            id={titleId}
            className="text-base"
            role={heading ? "heading" : undefined}
            aria-level={heading ? 2 : undefined}
          >
            {title}
          </CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </CardHeader>
      {/* A size container: field grids inside adapt to the card's width, whatever its span. */}
      <CardContent className="@container space-y-4">{children}</CardContent>
    </Card>
  );
}
