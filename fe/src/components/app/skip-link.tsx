"use client";

import { useTranslations } from "next-intl";

export interface SkipLinkProps {
  /** `id` of the page content container the link moves focus to (it needs `tabIndex={-1}`). */
  targetId: string;
}

// "Skip to content" link (WCAG 2.4.1): the first focusable element of the shell, visible only on focus.
// Activating it focuses the content container explicitly, so it works the same in every browser; without
// JavaScript the plain anchor still jumps there. `focus()` scrolls the container into view (it has `scroll-mt`).
export function SkipLink({ targetId }: SkipLinkProps) {
  const t = useTranslations("shell.skipLink");

  return (
    <a
      href={`#${targetId}`}
      onClick={(event) => {
        const target = document.getElementById(targetId);
        if (!target) return;
        event.preventDefault();
        target.focus();
      }}
      className="sr-only rounded-md bg-background px-4 py-2 text-sm font-medium text-foreground shadow-md ring-2 ring-ring focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
    >
      {t("label")}
    </a>
  );
}
