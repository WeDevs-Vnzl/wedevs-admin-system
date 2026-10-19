"use client";

import { defaultFilter } from "cmdk";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { visibleNavItems, visibleQuickActions } from "@/config/nav";
import {
  RecentRecordsGroup,
  SEARCH_HIT_VALUE_PREFIX,
  SearchResultGroups,
} from "@/features/search/components/search-command-groups";
import { readRecentRecords, rememberRecentRecord } from "@/features/search/recent-records";
import { recordOfPath } from "@/features/search/search-entities";
import { useGlobalSearch } from "@/features/search/use-global-search";
import type { SearchResultDTO } from "@/lib/validators/search";
import type { SessionUser } from "@/server/auth/types";
import { useBreadcrumbLabels } from "./breadcrumb-label";

// Hits come from `searchGlobal`, which already matched them (accents, typos, prefixes), so cmdk keeps every
// hit and only scores the navigation and quick-action items against the typed text.
function filterItems(value: string, search: string, keywords?: string[]) {
  return value.startsWith(SEARCH_HIT_VALUE_PREFIX) ? 1 : defaultFilter(value, search, keywords);
}

// Cmd+K / Ctrl+K global menu (PRD §7.6, frontend-patterns §7). Navigation comes from `nav.ts` and quick
// actions are filtered by `can()`. Typed text also searches the records (`searchGlobal`, HU-26), grouped by
// type; an exact code (`FAC-0012`) comes back alone, selected, so Enter opens it. With no text the menu
// lists the records visited recently (opened from here or any detail page, named by its breadcrumb).
// Items filter on their translated label (what the user reads, M2); the i18n key stays a keyword so the
// English key still matches.
export function CommandMenu({ user }: { user: SessionUser }) {
  const t = useTranslations("search");
  const tNav = useTranslations("nav.items");
  const router = useRouter();
  const pathname = usePathname();
  const labels = useBreadcrumbLabels();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const search = useGlobalSearch(open ? query : "");

  // A detail page registers its breadcrumb label; that label names the visit in the recents.
  const visitedLabel = useMemo(() => {
    const visited = recordOfPath(pathname);
    return visited ? labels[visited.segment] : undefined;
  }, [pathname, labels]);
  useEffect(() => {
    const visited = recordOfPath(pathname);
    if (!visited || !visitedLabel) return;
    rememberRecentRecord(user.id, {
      entityType: visited.entityType,
      entityId: visited.entityId,
      title: visitedLabel,
      code: null,
      href: visited.href,
    });
  }, [user.id, pathname, visitedLabel]);

  // Read when the menu opens, so it reflects the pages visited since.
  const recents = useMemo(() => (open ? readRecentRecords(user.id) : []), [open, user.id]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setQuery("");
        setOpen((current) => !current);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const navItems = visibleNavItems(user);
  const quickActions = visibleQuickActions(user);

  function changeOpen(next: boolean) {
    setOpen(next);
    if (!next) setQuery("");
  }

  function go(href: string) {
    changeOpen(false);
    router.push(href);
  }

  function openHit(hit: SearchResultDTO, href: string) {
    rememberRecentRecord(user.id, {
      entityType: hit.entityType,
      entityId: hit.entityId,
      title: hit.title,
      code: hit.code,
      href,
    });
    go(href);
  }

  const footer =
    search.status === "loading"
      ? t("searching")
      : search.status === "error"
        ? t("searchFailed")
        : t("prefixHint");

  // Composed from the registry Dialog parts (no CommandDialog). The button is the DialogTrigger so Radix knows where
  // to return focus when the menu closes (Escape, selection), also when Ctrl+K opened it (D4). The title and
  // description sit inside the content, visually hidden, so the dialog's accessible name and description are its own.
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          aria-label={t("trigger")}
          aria-keyshortcuts="Meta+K Control+K"
          className="w-9 gap-2 px-0 text-muted-foreground lg:w-44 lg:justify-start lg:px-2.5 xl:w-64"
        >
          <Search aria-hidden />
          <span className="hidden flex-1 text-start lg:inline">{t("trigger")}</span>
          <Kbd className="hidden xl:inline-flex">{t("shortcut")}</Kbd>
        </Button>
      </DialogTrigger>
      <DialogContent
        className="top-1/3 translate-y-0 overflow-hidden rounded-xl! p-0"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t("dialogTitle")}</DialogTitle>
          <DialogDescription>{t("dialogDescription")}</DialogDescription>
        </DialogHeader>
        <Command label={t("dialogTitle")} filter={filterItems}>
          <CommandInput placeholder={t("placeholder")} value={query} onValueChange={setQuery} />
          <CommandList label={t("listLabel")}>
            {search.status === "loading" ? null : <CommandEmpty>{t("empty")}</CommandEmpty>}
            {search.status === "ready" ? (
              <SearchResultGroups results={search.results} onOpen={openHit} />
            ) : null}
            {query.trim() === "" ? (
              <RecentRecordsGroup records={recents} onOpen={(record) => go(record.href)} />
            ) : null}
            <CommandGroup heading={t("navigation")}>
              {navItems.map((item) => {
                const label = tNav(item.key);
                return (
                  <CommandItem
                    key={item.key}
                    value={label}
                    keywords={[item.key]}
                    onSelect={() => go(item.href)}
                  >
                    <item.icon aria-hidden />
                    <span>{label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {quickActions.length > 0 ? (
              <>
                <CommandSeparator />
                <CommandGroup heading={t("quickActions")}>
                  {quickActions.map((action) => {
                    const label = t(`actions.${action.key}`);
                    return (
                      <CommandItem
                        key={action.key}
                        value={label}
                        keywords={[action.key]}
                        onSelect={() => go(action.href)}
                      >
                        <action.icon aria-hidden />
                        <span>{label}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
          {/* Outside the listbox so it holds only options and groups (R9). */}
          <CommandSeparator />
          <p role="status" className="px-2 py-3 text-center text-xs text-muted-foreground">
            {footer}
          </p>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
