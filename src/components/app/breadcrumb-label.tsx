"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type BreadcrumbLabels = Record<string, string>;

interface BreadcrumbLabelContextValue {
  labels: BreadcrumbLabels;
  register: (segment: string, label: string) => () => void;
}

const BreadcrumbLabelContext = createContext<BreadcrumbLabelContextValue>({
  labels: {},
  register: () => () => {},
});

// Labels that detail pages register for their id segment (`<BreadcrumbLabel />`), read by the topbar trail.
// Registration runs in an effect, so the server markup and the first client render show the fallback label.
export function BreadcrumbLabelProvider({ children }: { children: React.ReactNode }) {
  const [labels, setLabels] = useState<BreadcrumbLabels>({});

  const register = useCallback((segment: string, label: string) => {
    setLabels((current) => ({ ...current, [segment]: label }));
    return () =>
      setLabels((current) => {
        const next = { ...current };
        delete next[segment];
        return next;
      });
  }, []);

  const value = useMemo(() => ({ labels, register }), [labels, register]);
  return <BreadcrumbLabelContext.Provider value={value}>{children}</BreadcrumbLabelContext.Provider>;
}

export function useBreadcrumbLabels(): BreadcrumbLabels {
  return useContext(BreadcrumbLabelContext).labels;
}

// Names the id segment of a detail page in the topbar trail, e.g. `<BreadcrumbLabel segment="cli_1" label="CLI-0007 · Kairos Studio" />`.
// Renders nothing and unregisters on unmount.
export function BreadcrumbLabel({ segment, label }: { segment: string; label: string }) {
  const { register } = useContext(BreadcrumbLabelContext);

  useEffect(() => register(segment, label), [register, segment, label]);

  return null;
}
