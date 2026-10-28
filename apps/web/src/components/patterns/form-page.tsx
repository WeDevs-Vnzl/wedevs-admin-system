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
export function FormPage({
  title,
  description,
  backHref,
  children,
  footer,
  dirty = false,
}: FormPageProps) {
  const t = useTranslations("patterns.formPage");
  const tUnsaved = useTranslations("patterns.unsavedChanges");
  useUnsavedChanges(dirty, tUnsaved("message"));

  return (
    <div className="flex flex-col gap-6 pb-24">
      <header className="max-w-3xl space-y-3">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t("back")}
        </Link>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
      </header>
      {/* Two-column grid of SectionCards: each card spans 1 or 2 columns by its content (SectionCard `span`)
          and keeps its own height (`items-start`) instead of stretching to its row. */}
      <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2">{children}</div>
      <div className="sticky bottom-0 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex items-center justify-end gap-2">{footer}</div>
      </div>
    </div>
  );
}
