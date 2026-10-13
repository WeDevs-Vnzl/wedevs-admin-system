"use client";

import { parseAsString, useQueryState } from "nuqs";
import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type DetailTab = {
  value: string;
  label: ReactNode;
  // Shown as a count next to the label.
  count?: number;
  content: ReactNode;
};

type DetailTabsProps = {
  tabs: DetailTab[];
  defaultTab: string;
  // Query parameter holding the active tab (frontend-patterns §4).
  paramName?: string;
};

// Detail tabs selected through `?tab=` (nuqs). An unknown or missing value falls back to defaultTab.
export function DetailTabs({ tabs, defaultTab, paramName = "tab" }: DetailTabsProps) {
  const [requested, setRequested] = useQueryState(paramName, parseAsString.withDefault(defaultTab));
  const active = tabs.some((tab) => tab.value === requested) ? requested : defaultTab;

  return (
    <Tabs value={active} onValueChange={(value) => void setRequested(value)} className="gap-4">
      <TabsList variant="line" className="w-full justify-start overflow-x-auto">
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} className="gap-2">
            {tab.label}
            {tab.count === undefined ? null : (
              <span className="bg-muted text-muted-foreground rounded-full px-1.5 text-xs tabular-nums">
                {tab.count}
              </span>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value}>
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
