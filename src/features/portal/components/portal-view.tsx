"use client";

import { Building2Icon, ClockIcon, LockIcon } from "lucide-react";
import { NextIntlClientProvider, useFormatter, useLocale, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { BrandMark } from "@/components/app/brand-mark";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { isLocale, timeZone, type Locale } from "@/i18n/config";
import type { PortalShareDTO } from "@/lib/validators/shares";
import { portalMessages } from "../messages";
import { PortalDocumentCard } from "./portal-document-card";
import { PortalViewer } from "./portal-viewer";
import { UnlockDialog } from "./unlock-dialog";

export interface PortalViewProps {
  token: string;
  page: PortalShareDTO;
}

/**
 * The public portal `/s/[token]` (PRD §8.11, wireframe 4.8, DT-51): WeDevs brand, title, message, documents and the
 * viewer. It speaks the link's language and lets the visitor switch ES / EN in place.
 */
export function PortalView({ token, page }: PortalViewProps) {
  const [locale, setLocale] = useState<Locale>(page.locale);
  return (
    <NextIntlClientProvider locale={locale} messages={portalMessages[locale]} timeZone={timeZone}>
      <div lang={locale} className="flex min-h-svh flex-col bg-background text-foreground">
        <PortalScreen token={token} page={page} onLocaleChange={setLocale} />
      </div>
    </NextIntlClientProvider>
  );
}

function PortalScreen({
  token,
  page,
  onLocaleChange,
}: PortalViewProps & { onLocaleChange: (locale: Locale) => void }) {
  const t = useTranslations("portal");
  const format = useFormatter();
  const locale = useLocale();
  const [unlockedIds, setUnlockedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [unlockId, setUnlockId] = useState<string | null>(null);
  const viewerRef = useRef<HTMLDivElement>(null);

  const documents = page.documents.map((doc) =>
    doc.locked && unlockedIds.has(doc.documentId) ? { ...doc, locked: false } : doc,
  );
  const selected = documents.find((doc) => doc.documentId === selectedId && !doc.locked) ?? null;
  const unlocking = documents.find((doc) => doc.documentId === unlockId) ?? null;

  function view(documentId: string) {
    setSelectedId(documentId);
    // On a phone the viewer sits under the list.
    viewerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <>
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-8">
          <div className="flex items-center gap-2.5">
            <BrandMark />
            <span className="text-base font-semibold">{t("brand")}</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="hidden gap-1.5 rounded-full px-3 py-1 sm:inline-flex"
            >
              <LockIcon aria-hidden />
              {t("privateLink")}
            </Badge>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={locale}
              aria-label={t("language")}
              onValueChange={(value) => {
                if (isLocale(value)) onLocaleChange(value);
              }}
            >
              <ToggleGroupItem value="es" lang="es">
                ES
              </ToggleGroupItem>
              <ToggleGroupItem value="en" lang="en">
                EN
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-8 sm:py-10">
        <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          {t("eyebrow")}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          {page.title}
        </h1>
        {page.message ? (
          <p className="mt-2 max-w-3xl text-sm whitespace-pre-line text-muted-foreground sm:text-base">
            {page.message}
          </p>
        ) : null}
        {page.clientName || page.expiresAt ? (
          <ul className="mt-4 flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:gap-6">
            {page.clientName ? (
              <li className="flex items-center gap-1.5">
                <Building2Icon aria-hidden className="size-4" />
                <span className="text-foreground">{page.clientName}</span>
              </li>
            ) : null}
            {page.expiresAt ? (
              <li className="flex items-center gap-1.5">
                <ClockIcon aria-hidden className="size-4" />
                {t("availableUntil", {
                  date: format.dateTime(new Date(`${page.expiresAt}T12:00:00Z`), {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  }),
                })}
              </li>
            ) : null}
          </ul>
        ) : null}

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <ul aria-label={t("documentsLabel")} className="flex flex-col gap-3">
            {documents.map((doc) => (
              <li key={doc.documentId}>
                <PortalDocumentCard
                  token={token}
                  document={doc}
                  allowDownload={page.allowDownload}
                  selected={doc.documentId === selected?.documentId}
                  onView={() => view(doc.documentId)}
                  onUnlock={() => setUnlockId(doc.documentId)}
                />
              </li>
            ))}
          </ul>
          <div ref={viewerRef} className="min-w-0 scroll-mt-4">
            <PortalViewer token={token} document={selected} allowDownload={page.allowDownload} />
          </div>
        </div>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-5 text-xs text-muted-foreground sm:flex-row sm:justify-between sm:px-8">
          <p className="flex items-center gap-1.5">
            <LockIcon aria-hidden className="size-3.5" />
            {t("footer.personal")}
          </p>
          <p>{t("footer.copyright", { year: new Date().getFullYear() })}</p>
        </div>
      </footer>

      <UnlockDialog
        token={token}
        document={unlocking}
        onClose={() => setUnlockId(null)}
        onUnlocked={(documentId) => {
          setUnlockedIds((ids) => new Set(ids).add(documentId));
          setUnlockId(null);
          view(documentId);
        }}
      />
    </>
  );
}
