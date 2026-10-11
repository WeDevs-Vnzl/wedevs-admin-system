"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * Returns focus to the element that opened a dialog once it closes (wave 2 defect T1). Dialogs opened
 * programmatically have no trigger for Radix to return focus to, so the element focused at opening is kept.
 * The focus moves after the close has committed, and only if that element is still in the document.
 */
export function useOpenerFocus(open: boolean) {
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(open);

  // Read before the dialog's focus scope moves focus into the dialog (its effect runs after every layout effect),
  // otherwise the element kept is a field inside the dialog and the focus is lost on close.
  useLayoutEffect(() => {
    if (!open || wasOpen.current) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, [open]);

  useEffect(() => {
    if (open === wasOpen.current) return;
    wasOpen.current = open;
    if (open) return;
    const target = opener.current;
    opener.current = null;
    if (!target) return;
    const timer = setTimeout(() => {
      if (target.isConnected) target.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [open]);
}
