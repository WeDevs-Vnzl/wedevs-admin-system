import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { BrandMark } from "@/components/app/brand-mark";
import { cn } from "@/lib/utils";
import "./print-view.css";

export interface PrintRegionProps {
  /** Document title printed in the letterhead. */
  title: string;
  /** Secondary line of the letterhead, e.g. "DOC-0001 · v3 · 14/10/2026". */
  subtitle?: string;
  children: ReactNode;
  className?: string;
}

/**
 * The printable part of a page (PRD §8.9.5). While printing, everything outside the element marked
 * `data-print-region` is hidden (sidebar, header, footer, buttons) and the WeDevs letterhead, hidden on
 * screen, heads the page. Mark extra on-screen controls inside the region with `data-print-hide`.
 *
 * Usage (document detail, T5):
 *   <PrintButton />
 *   <PrintRegion title={doc.title} subtitle={`${doc.code} · v${version.number}`}>
 *     <MarkdownView content={version.content} />
 *   </PrintRegion>
 *
 * Server-renderable; only `PrintButton` is a client component. Render one region per page.
 */
export function PrintRegion({ title, subtitle, children, className }: PrintRegionProps) {
  const t = useTranslations("documents.print");
  return (
    <div data-print-region="" className={cn("min-w-0", className)}>
      <header
        data-print-letterhead=""
        className="mb-6 hidden items-center gap-3 border-b border-border pb-4 print:flex"
      >
        <BrandMark />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{t("brand")}</p>
          <p className="truncate text-xs text-muted-foreground">{title}</p>
        </div>
        {subtitle ? (
          <p className="shrink-0 text-xs text-muted-foreground tabular-nums">{subtitle}</p>
        ) : null}
      </header>
      {children}
    </div>
  );
}
