"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { visibleNavItems, visibleQuickActions } from "@/config/nav";
import type { SessionUser } from "@/server/auth/types";

// Cmd+K / Ctrl+K global menu (PRD §7.6, frontend-patterns §7). Navigation comes from `nav.ts` and quick
// actions are filtered by `can()`. Record search arrives with the search query in H1-B5; until then the
// results area shows a pending note instead of results.
// Items filter on their translated label (what the user reads, M2); the i18n key stays a keyword so the
// English key still matches.
export function CommandMenu({ user }: { user: SessionUser }) {
  const t = useTranslations("search");
  const tNav = useTranslations("nav.items");
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((current) => !current);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const navItems = visibleNavItems(user);
  const quickActions = visibleQuickActions(user);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <>
      <Button
        variant="outline"
        aria-label={t("trigger")}
        aria-keyshortcuts="Meta+K Control+K"
        onClick={() => setOpen(true)}
        className="h-9 justify-start gap-2 text-muted-foreground md:w-64"
      >
        <Search aria-hidden />
        <span className="hidden flex-1 text-start md:inline">{t("trigger")}</span>
        <Kbd className="hidden md:inline-flex">{t("shortcut")}</Kbd>
      </Button>

      {/* Composed from the registry Dialog parts (no CommandDialog): the title and description sit inside the
          content, visually hidden, so the dialog's accessible name and description are its own. */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="top-1/3 translate-y-0 overflow-hidden rounded-xl! p-0"
          showCloseButton={false}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>{t("dialogTitle")}</DialogTitle>
            <DialogDescription>{t("dialogDescription")}</DialogDescription>
          </DialogHeader>
          <Command label={t("dialogTitle")}>
            <CommandInput placeholder={t("placeholder")} />
            <CommandList label={t("listLabel")}>
              <CommandEmpty>{t("empty")}</CommandEmpty>
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
            <div className="px-2 py-4 text-center text-sm text-muted-foreground">
              <p className="font-medium text-foreground">{t("results")}</p>
              <p>{t("resultsPending")}</p>
            </div>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
