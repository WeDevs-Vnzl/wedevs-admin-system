"use client";

import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setPreferenceAction } from "@/features/preferences/actions";
import { isLocale, localeCookieName, locales } from "@/i18n/config";

const ONE_YEAR_IN_SECONDS = 60 * 60 * 24 * 365;

// Composed from the shadcn dropdown-menu and button registry items (DU-02).
// The choice is stored in the NEXT_LOCALE cookie and refreshes the server request config; it is also saved as
// the user's `locale` preference (M3), so the Preferences form and the topbar read the same value. If the save
// fails, the local change stays and the error is shown.
export function LocaleSwitcher() {
  const t = useTranslations("shell.localeSwitcher");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleChange(value: string) {
    if (!isLocale(value) || value === locale) return;

    document.cookie = `${localeCookieName}=${value}; path=/; max-age=${ONE_YEAR_IN_SECONDS}; SameSite=Lax`;
    startTransition(async () => {
      router.refresh();
      const result = await setPreferenceAction({ key: "locale", value });
      if (!result.ok) {
        const code = result.error.code;
        toast.error(tCommon.has(`errors.${code}`) ? tCommon(`errors.${code}`) : tCommon("errors.INTERNAL"));
      }
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("label")} disabled={isPending}>
          <Languages />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={locale} onValueChange={handleChange}>
          {locales.map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              {t(`locales.${option}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
