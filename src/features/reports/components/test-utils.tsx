import type { ReactNode } from "react";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import esCommon from "@/i18n/messages/es/common.json";
import esPatterns from "@/i18n/messages/es/patterns.json";
import esReports from "@/i18n/messages/es/reports.json";

/** Renders `ui` with the Spanish messages the report screens read. Test only. */
export function renderWithIntl(ui: ReactNode) {
  return render(
    <NextIntlClientProvider
      locale="es"
      timeZone="America/Caracas"
      messages={{ common: esCommon, patterns: esPatterns, reports: esReports }}
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

/** jsdom has no ResizeObserver; recharts' responsive container needs one to mount. */
export function installResizeObserver() {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
