import type { AbstractIntlMessages } from "next-intl";
import enCommon from "@/i18n/messages/en/common.json";
import enDocuments from "@/i18n/messages/en/documents.json";
import enPortal from "@/i18n/messages/en/portal.json";
import esCommon from "@/i18n/messages/es/common.json";
import esDocuments from "@/i18n/messages/es/documents.json";
import esPortal from "@/i18n/messages/es/portal.json";
import type { Locale } from "@/lib/validators/preferences";

// The portal speaks the link's language, not the visitor's back-office preference, and the visitor can switch it
// without a reload (frontend-patterns §11). So the portal ships both catalogs of what it renders: its own
// namespace, `common` (viewer toolbar, retry) and the print letterhead of `documents`.
export const portalMessages: Record<Locale, AbstractIntlMessages> = {
  es: { portal: esPortal, common: esCommon, documents: { print: esDocuments.print } },
  en: { portal: enPortal, common: enCommon, documents: { print: enDocuments.print } },
};
