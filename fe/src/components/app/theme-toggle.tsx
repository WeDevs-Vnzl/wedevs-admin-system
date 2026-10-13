"use client";

import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
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
import { themeSchema } from "@/lib/validators/preferences";

// Composed from the shadcn dropdown-menu and button registry items (DU-02).
// The theme applies locally through next-themes and is also saved as the user's `theme` preference (M3). If the
// save fails, the local theme stays and the error is shown.
export function ThemeToggle() {
  const t = useTranslations("shell.themeToggle");
  const tCommon = useTranslations("common");
  const { theme, setTheme } = useTheme();

  async function handleChange(value: string) {
    const parsed = themeSchema.safeParse(value);
    if (!parsed.success) return;
    setTheme(parsed.data);

    const result = await setPreferenceAction({ key: "theme", value: parsed.data });
    if (!result.ok) {
      const code = result.error.code;
      toast.error(
        tCommon.has(`errors.${code}`) ? tCommon(`errors.${code}`) : tCommon("errors.INTERNAL"),
      );
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("label")}>
          <Sun className="dark:hidden" />
          <Moon className="hidden dark:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={handleChange}>
          <DropdownMenuRadioItem value="light">{t("light")}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">{t("dark")}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">{t("system")}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
