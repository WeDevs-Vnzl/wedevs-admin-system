import type { ReactNode } from "react";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enCatalogs from "@/i18n/messages/en/catalogs.json";
import enCommon from "@/i18n/messages/en/common.json";
import enEnums from "@/i18n/messages/en/enums.json";
import enPatterns from "@/i18n/messages/en/patterns.json";
import enSettings from "@/i18n/messages/en/settings.json";
import enTable from "@/i18n/messages/en/table.json";
import enValidation from "@/i18n/messages/en/validation.json";

/** Renders `ui` with the English messages the finance catalog screens read. Test only. */
export function renderWithIntl(ui: ReactNode) {
  return render(
    <NextIntlClientProvider
      locale="en"
      timeZone="America/Caracas"
      messages={{
        catalogs: enCatalogs,
        common: enCommon,
        enums: enEnums,
        patterns: enPatterns,
        settings: enSettings,
        table: enTable,
        validation: enValidation,
      }}
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

export function installResizeObserver() {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
