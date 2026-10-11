"use client";

import { useEffect, useRef } from "react";

/**
 * Returns focus to the element that opened a dialog once it closes (wave 2 defect T1). Dialogs opened
 * programmatically have no trigger for Radix to return focus to, so the element focused at opening is kept.
 * The focus moves after the close has committed, and only if that element is still in the document.
 */
export function useOpenerFocus(open: boolean) {
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(open);

  useEffect(() => {
    if (open === wasOpen.current) return;
    wasOpen.current = open;
    if (open) {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      return;
    }
    const target = opener.current;
    opener.current = null;
    if (!target) return;
    const timer = setTimeout(() => {
      if (target.isConnected) target.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [open]);
}
