"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useUnsavedChanges } from "./use-unsaved-changes";

type FormPageProps = {
  title: string;
  description?: string;
  backHref: string;
  // SectionCard blocks.
  children: ReactNode;
  // Sticky footer actions (Cancel / Save).
  footer: ReactNode;
  // Pass react-hook-form's isDirty; enables the unsaved-changes guard.
  dirty?: boolean;
};

// Full-page form layout at /new and /[id]/edit (frontend-patterns §6).
export function FormPage({ title, description, backHref, children, footer, dirty = false }: FormPageProps) {
  const t = useTranslations("patterns.unsavedChanges");
  useUnsavedChanges(dirty, t("message"));

  return (
    <div className="flex flex-col gap-6 pb-24">
      <header className="space-y-2">
        <Link href={backHref} className="text-muted-foreground inline-flex items-center gap-1 text-sm">
          <ArrowLeft className="size-4" aria-hidden />
          {title}
        </Link>
        {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
      </header>
      <div className="grid gap-6">{children}</div>
      <div className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky bottom-0 -mx-4 flex items-center justify-end gap-2 border-t px-4 py-3 backdrop-blur">
        {footer}
      </div>
    </div>
  );
}
