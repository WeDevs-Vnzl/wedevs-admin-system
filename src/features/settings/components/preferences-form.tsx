"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { FormPage } from "@/components/patterns/form-page";
import { SectionCard } from "@/components/patterns/section-card";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setPreferenceAction } from "@/features/preferences/actions";
import { localeCookieName } from "@/i18n/config";
import {
  LOCALE_VALUES,
  THEME_VALUES,
  localeSchema,
  themeSchema,
  timezoneSchema,
  type SetPreferenceInput,
  type UserPreferencesDTO,
} from "@/lib/validators/preferences";
import { z } from "@/lib/validators/zod";

const ONE_YEAR_IN_SECONDS = 60 * 60 * 24 * 365;

// Same cookie LocaleSwitcher writes (`src/components/app/locale-switcher.tsx`); the server request config reads it.
function writeLocaleCookie(locale: string) {
  document.cookie = `${localeCookieName}=${locale}; path=/; max-age=${ONE_YEAR_IN_SECONDS}; SameSite=Lax`;
}

const preferencesFormSchema = z.object({
  locale: localeSchema,
  theme: themeSchema,
  timezone: timezoneSchema,
});
type PreferencesFormValues = z.infer<typeof preferencesFormSchema>;

type PreferencesFormProps = {
  initial: Pick<UserPreferencesDTO, "locale" | "theme" | "timezone">;
  // IANA zones offered in the time-zone select (the current value is always offered too).
  timezones: readonly string[];
};

// Preferences of the signed-in user (PRD §8.15, DT-43). Only the fields that changed are saved, one
// `setPreference` call each. The language also writes NEXT_LOCALE (what LocaleSwitcher writes) and the theme
// goes through next-themes (what ThemeToggle uses), so the change applies at once.
export function PreferencesForm({ initial, timezones }: PreferencesFormProps) {
  const t = useTranslations("settings");
  const router = useRouter();
  const { setTheme } = useTheme();
  const form = useForm<PreferencesFormValues>({
    resolver: zodResolver(preferencesFormSchema),
    defaultValues: initial,
  });

  const zones = timezones.includes(initial.timezone) ? timezones : [initial.timezone, ...timezones];

  async function onSubmit(values: PreferencesFormValues) {
    const changes: SetPreferenceInput[] = [];
    if (form.getFieldState("locale").isDirty) changes.push({ key: "locale", value: values.locale });
    if (form.getFieldState("theme").isDirty) changes.push({ key: "theme", value: values.theme });
    if (form.getFieldState("timezone").isDirty) changes.push({ key: "timezone", value: values.timezone });

    for (const change of changes) {
      const result = await setPreferenceAction(change);
      if (!result.ok) {
        toast.error(t("preferences.saveError"));
        return;
      }
    }

    if (changes.some((change) => change.key === "locale")) {
      writeLocaleCookie(values.locale);
    }
    if (changes.some((change) => change.key === "theme")) {
      setTheme(values.theme);
    }

    form.reset(values);
    toast.success(t("preferences.saved"));
    router.refresh();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FormPage
        title={t("nav.label")}
        description={t("preferences.description")}
        backHref="/settings"
        dirty={form.formState.isDirty}
        footer={
          <Button type="submit" disabled={!form.formState.isDirty || form.formState.isSubmitting}>
            {form.formState.isSubmitting ? t("preferences.saving") : t("preferences.save")}
          </Button>
        }
      >
        <SectionCard title={t("preferences.title")}>
          <Controller
            control={form.control}
            name="locale"
            render={({ field }) => (
              <Field>
                <FieldLabel id="preferences-locale-label">{t("preferences.language.label")}</FieldLabel>
                <p className="text-muted-foreground text-sm">{t("preferences.language.description")}</p>
                <RadioGroup
                  value={field.value}
                  onValueChange={field.onChange}
                  aria-labelledby="preferences-locale-label"
                  className="grid gap-2 sm:grid-cols-2"
                >
                  {LOCALE_VALUES.map((locale) => (
                    <Field key={locale} orientation="horizontal">
                      <RadioGroupItem id={`preferences-locale-${locale}`} value={locale} />
                      <FieldLabel htmlFor={`preferences-locale-${locale}`} className="font-normal">
                        {t(`preferences.language.${locale}`)}
                      </FieldLabel>
                    </Field>
                  ))}
                </RadioGroup>
              </Field>
            )}
          />

          <Controller
            control={form.control}
            name="theme"
            render={({ field }) => (
              <Field>
                <FieldLabel id="preferences-theme-label">{t("preferences.theme.label")}</FieldLabel>
                <p className="text-muted-foreground text-sm">{t("preferences.theme.description")}</p>
                <RadioGroup
                  value={field.value}
                  onValueChange={field.onChange}
                  aria-labelledby="preferences-theme-label"
                  className="grid gap-2 sm:grid-cols-3"
                >
                  {THEME_VALUES.map((theme) => (
                    <Field key={theme} orientation="horizontal">
                      <RadioGroupItem id={`preferences-theme-${theme}`} value={theme} />
                      <FieldLabel htmlFor={`preferences-theme-${theme}`} className="font-normal">
                        {t(`preferences.theme.${theme}`)}
                      </FieldLabel>
                    </Field>
                  ))}
                </RadioGroup>
              </Field>
            )}
          />

          <Controller
            control={form.control}
            name="timezone"
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor="preferences-timezone">{t("preferences.timezone.label")}</FieldLabel>
                <p className="text-muted-foreground text-sm">{t("preferences.timezone.description")}</p>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="preferences-timezone" className="w-full sm:w-80">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {zones.map((zone) => (
                      <SelectItem key={zone} value={zone}>
                        {zone}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          />
        </SectionCard>
      </FormPage>
    </form>
  );
}
