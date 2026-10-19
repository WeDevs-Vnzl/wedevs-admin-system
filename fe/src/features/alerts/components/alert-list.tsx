"use client";

import { Bell } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/patterns/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  dismissAlertAction,
  listAlertsAction,
  restoreAlertAction,
  snoozeAlertAction,
} from "@/features/alerts/actions";
import type { AlertDTO, AlertsInboxDTO, AlertType } from "@/lib/validators/alerts";
import type { ErrorCode } from "@/lib/validators/common";
import { cn } from "@/lib/utils";
import { AlertItem } from "./alert-item";

export interface AlertListProps {
  /** `compact` for the bell panel, `full` for the dashboard and module overviews. */
  variant?: "compact" | "full";
  /** Narrows to some alert types, e.g. a module overview's own alerts. */
  types?: readonly AlertType[];
  /** Maximum alerts shown (the service default, 50, when omitted). */
  limit?: number;
  /** Called with the active total whenever the list is (re)loaded or changes. */
  onTotalChange?: (total: number) => void;
  /** Called with the whole inbox (unread counter and read keys included) on every (re)load. */
  onLoad?: (inbox: AlertsInboxDTO) => void;
  className?: string;
}

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; items: AlertDTO[]; total: number };

// The current user's alerts (PRD §7.9). Loads through `listAlertsAction`, so the list shows exactly what
// the bell counter counts; dismiss and snooze act on the caller's own state and offer an undo.
export function AlertList({
  variant = "full",
  types,
  limit,
  onTotalChange,
  onLoad,
  className,
}: AlertListProps) {
  const t = useTranslations("alerts");
  const tCommon = useTranslations("common");
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [pending, setPending] = useState<string | null>(null);
  const regionRef = useRef<HTMLDivElement>(null);
  // Index the focus returns to once the list reloads after a dismiss or snooze (the next alert).
  const focusIndex = useRef<number | null>(null);
  const typesKey = types?.join(",") ?? "";
  const onTotal = useRef(onTotalChange);
  const onInbox = useRef(onLoad);
  useEffect(() => {
    onTotal.current = onTotalChange;
    onInbox.current = onLoad;
  }, [onTotalChange, onLoad]);

  const load = useCallback(async () => {
    const result = await listAlertsAction({
      ...(typesKey ? { types: typesKey.split(",") as AlertType[] } : {}),
      ...(limit ? { limit } : {}),
    });
    if (!result.ok) {
      setState({ status: "error" });
      return;
    }
    setState({ status: "ready", items: result.data.items, total: result.data.total });
    onTotal.current?.(result.data.total);
    onInbox.current?.(result.data);
  }, [typesKey, limit]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    if (state.status !== "ready" || focusIndex.current === null) return;
    const rows = regionRef.current?.querySelectorAll<HTMLElement>("li");
    const index = Math.min(focusIndex.current, (rows?.length ?? 0) - 1);
    focusIndex.current = null;
    const target =
      index >= 0 ? rows?.[index]?.querySelector<HTMLElement>("a, button:not(:disabled)") : null;
    (target ?? regionRef.current)?.focus();
  }, [state]);

  const fail = (code: ErrorCode) => toast.error(tCommon(`errors.${code}`));

  const undo = async (alertKey: string) => {
    const result = await restoreAlertAction({ alertKey });
    if (!result.ok) return fail(result.error.code);
    toast.success(t("toasts.restored"));
    await load();
  };

  const changed = async (alert: AlertDTO, message: string) => {
    toast(message, {
      action: { label: t("actions.undo"), onClick: () => void undo(alert.alertKey) },
    });
    await load();
  };

  const rememberPosition = (alert: AlertDTO) => {
    if (state.status === "ready") {
      focusIndex.current = state.items.findIndex((item) => item.alertKey === alert.alertKey);
    }
  };

  const dismiss = async (alert: AlertDTO) => {
    rememberPosition(alert);
    setPending(alert.alertKey);
    const result = await dismissAlertAction({ alertKey: alert.alertKey });
    setPending(null);
    if (!result.ok) {
      focusIndex.current = null;
      return fail(result.error.code);
    }
    await changed(alert, t("toasts.dismissed"));
  };

  const snooze = async (alert: AlertDTO, days: number) => {
    rememberPosition(alert);
    setPending(alert.alertKey);
    const result = await snoozeAlertAction({ alertKey: alert.alertKey, days });
    setPending(null);
    if (!result.ok) {
      focusIndex.current = null;
      return fail(result.error.code);
    }
    await changed(alert, t("toasts.snoozed", { days }));
  };

  if (state.status === "loading") {
    return (
      <div
        role="status"
        aria-label={t("list.loading")}
        className={cn("flex flex-col gap-2", className)}
      >
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }
  if (state.status === "error") {
    return <EmptyState icon={Bell} title={t("list.loadFailed")} />;
  }
  // The region takes focus when no alert is left to move it to.
  if (state.items.length === 0) {
    return (
      <div ref={regionRef} tabIndex={-1} className="outline-none">
        <EmptyState icon={Bell} title={t("list.empty")} />
      </div>
    );
  }

  return (
    <div ref={regionRef} tabIndex={-1} className="outline-none">
      <ul
        aria-label={t("list.label")}
        className={cn("flex flex-col gap-2", variant === "full" && "gap-3", className)}
      >
        {state.items.map((alert) => (
          <li key={alert.alertKey}>
            <AlertItem
              alert={alert}
              compact={variant === "compact"}
              busy={pending === alert.alertKey}
              onDismiss={dismiss}
              onSnooze={snooze}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
