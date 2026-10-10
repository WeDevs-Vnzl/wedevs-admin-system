"use client";

import { useEffect } from "react";

/**
 * Guards a dirty form against leaving the page (frontend-patterns §6). While `dirty` is true:
 * - closing or reloading the tab shows the browser's own leave prompt (`beforeunload`);
 * - clicking an in-app link asks for confirmation with `message` (`window.confirm`).
 *
 * Next's App Router has no route-blocking API, so in-app navigation is guarded by intercepting
 * same-tab link clicks in the capture phase. Modified clicks and links opening a new tab pass through.
 */
export function useUnsavedChanges(dirty: boolean, message: string) {
  useEffect(() => {
    if (!dirty) return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank") return;
      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, message]);
}
