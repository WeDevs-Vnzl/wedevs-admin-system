"use client";

import { Info } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type FieldInfoProps = {
  // Field label, used in the trigger's accessible name.
  field: string;
  // Supplementary explanation. Anything the user needs to fill the field goes in a FieldDescription instead:
  // a tooltip does not open on touch.
  children: ReactNode;
};

// Info button placed next to a field label; shows a short definition on hover or keyboard focus.
export function FieldInfo({ field, children }: FieldInfoProps) {
  const t = useTranslations("patterns.fieldHint");

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="size-5 text-muted-foreground hover:text-foreground"
            aria-label={t("info", { field })}
          >
            <Info aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-pretty">
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// "(opcional)" suffix for a label. Hidden from assistive tech: the control carries no aria-required, so the
// field is already announced as optional, and the label keeps its plain accessible name.
export function OptionalMark() {
  const t = useTranslations("patterns.fieldHint");
  return (
    <span aria-hidden="true" className="font-normal text-muted-foreground">
      {t("optional")}
    </span>
  );
}
