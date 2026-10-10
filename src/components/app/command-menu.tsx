"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { visibleNavItems, visibleQuickActions } from "@/config/nav";
import type { SessionUser } from "@/server/auth/types";

// Cmd+K / Ctrl+K global menu (PRD §7.6, frontend-patterns §7). Navigation comes from `nav.ts` and quick
// actions are filtered by `can()`. Record search arrives with the search query in H1-B5; until then the
// results area shows a pending note instead of results.
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

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title={t("dialogTitle")}
        description={t("dialogDescription")}
      >
        {/* The registry's CommandDialog does not wrap its children in <Command>; cmdk needs that root. */}
        <Command>
          <CommandInput placeholder={t("placeholder")} />
          <CommandList>
            <CommandEmpty>{t("empty")}</CommandEmpty>
            <CommandGroup heading={t("navigation")}>
              {navItems.map((item) => (
                <CommandItem
                  key={item.key}
                  value={`nav ${item.key}`}
                  onSelect={() => go(item.href)}
                >
                  <item.icon aria-hidden />
                  <span>{tNav(item.key)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            {quickActions.length > 0 ? (
              <>
                <CommandSeparator />
                <CommandGroup heading={t("quickActions")}>
                  {quickActions.map((action) => (
                    <CommandItem
                      key={action.key}
                      value={`action ${action.key}`}
                      onSelect={() => go(action.href)}
                    >
                      <action.icon aria-hidden />
                      <span>{t(`actions.${action.key}`)}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            ) : null}
            <CommandSeparator />
            <CommandGroup heading={t("results")}>
              <p className="px-2 py-4 text-center text-sm text-muted-foreground">
                {t("resultsPending")}
              </p>
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
