import { useId, type ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type SectionCardProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  // Form sections: exposes the card as a group named by its title, so a screen reader announces it with its fields.
  group?: boolean;
  children: ReactNode;
};

// Titled section of a form or detail page (rounded card, ~16 px radius).
export function SectionCard({
  title,
  description,
  actions,
  group = false,
  children,
}: SectionCardProps) {
  const titleId = useId();
  return (
    <Card
      className="rounded-2xl"
      role={group ? "group" : undefined}
      aria-labelledby={group ? titleId : undefined}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle id={titleId} className="text-base">
            {title}
          </CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}
