"use client";

import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { DateText } from "@/components/patterns/date-text";
import { SidePanelCard } from "@/components/patterns/side-panel-card";
import type { DocumentDetailDTO } from "@/lib/validators/documents";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end font-medium">{children}</dd>
    </div>
  );
}

/**
 * Side panel of `/documents/[id]`: the metadata the type allows (signature date only on types with signature, expiry
 * only on types with expiration), the current format and version, and who created it.
 */
export function DocumentDetailPanel({ document }: { document: DocumentDetailDTO }) {
  const t = useTranslations("documents.detail.panel");
  const tFormat = useTranslations("enums.DocumentFormat");
  const locale = useLocale();
  const local = (item: { name: string; nameEn: string | null }) =>
    locale === "en" && item.nameEn ? item.nameEn : item.name;
  const date = (value: string | null) => (value ? <DateText value={value} /> : t("notSet"));
  const version = document.currentVersion;

  return (
    <SidePanelCard title={t("title")}>
      <dl className="space-y-3">
        <Row label={t("category")}>{local(document.category)}</Row>
        <Row label={t("type")}>{local(document.type)}</Row>
        <Row label={t("format")}>{version ? tFormat(version.format) : t("notSet")}</Row>
        <Row label={t("version")}>{version ? `v${version.versionNumber}` : t("notSet")}</Row>
        <Row label={t("versionCount")}>
          <span className="tabular-nums">{document.versionCount}</span>
        </Row>
        <Row label={t("effectiveDate")}>{date(document.effectiveDate)}</Row>
        {document.type.requiresSignature ? (
          <Row label={t("signedAt")}>{date(document.signedAt)}</Row>
        ) : null}
        {document.type.hasExpiration ? (
          <Row label={t("expiresAt")}>{date(document.expiresAt)}</Row>
        ) : null}
        <Row label={t("shared")}>{document.isShared ? t("yes") : t("no")}</Row>
        <Row label={t("createdBy")}>{document.createdBy?.name ?? t("notSet")}</Row>
        <Row label={t("updatedAt")}>
          <DateText value={new Date(document.updatedAt)} />
        </Row>
      </dl>
      {document.summary ? (
        <div className="space-y-1 border-t pt-3">
          <p className="text-muted-foreground">{t("summary")}</p>
          <p className="whitespace-pre-line">{document.summary}</p>
        </div>
      ) : null}
    </SidePanelCard>
  );
}
