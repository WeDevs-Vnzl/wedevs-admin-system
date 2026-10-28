"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, Ban, Copy, ExternalLink, Pencil } from "lucide-react";
import { toast } from "sonner";
import { DateText } from "@/components/patterns/date-text";
import { SectionCard } from "@/components/patterns/section-card";
import { StatGrid } from "@/components/patterns/stat-grid";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { Paginated } from "@/lib/validators/common";
import type {
  ShareAccessLogRowDTO,
  ShareDocumentDTO,
  ShareLinkDetailDTO,
} from "@/lib/validators/shares";
import { revokeShareLinkAction, updateShareLinkAction } from "../actions";
import type { OneTimeAccessKey, ShareableDocument } from "../types";
import { copyToClipboard } from "./copy-to-clipboard";
import { OneTimeKeysDialog } from "./one-time-keys-dialog";
import { oneTimeKeysOf } from "./one-time-keys";
import { ShareAccessLog } from "./share-access-log";
import { ShareDocumentsTable } from "./share-documents-table";
import { ShareForm, type ShareFormRow } from "./share-form";
import { ShareQrCode } from "./share-qr-code";
import { ShareStatusBadge } from "./share-status-badge";

interface ShareDetailProps {
  share: ShareLinkDetailDTO;
  /** The link's documents with their versions, for the edit form's version pin. */
  shareableDocuments: readonly ShareableDocument[];
  /** First page of the access table. */
  accessLog: Paginated<ShareAccessLogRowDTO>;
  /** `share` update grant (Owner/Admin): edit, revoke and keys. */
  canUpdate: boolean;
}

/**
 * `/documents/shares/[id]` (PRD §8.11 "Gestión" and "Trazabilidad"): public URL with copy and QR, revoke, edit
 * (title, message, language, expiry, documents), counters including failed unlocks, the documents with their version
 * pin and access keys (DT-45), and the access table.
 */
export function ShareDetail({ share, shareableDocuments, accessLog, canUpdate }: ShareDetailProps) {
  const t = useTranslations("shares.detail");
  const tActions = useTranslations("common.actions");
  const router = useRouter();
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editKeys, setEditKeys] = useState<OneTimeAccessKey[] | null>(null);
  const [pending, startTransition] = useTransition();
  const manageable = canUpdate && share.status !== "REVOKED";

  function revoke() {
    startTransition(async () => {
      const result = await revokeShareLinkAction({ id: share.id });
      setRevokeOpen(false);
      if (!result.ok) {
        toast.error(t("revokeFailed"));
        return;
      }
      toast.success(t("revoked"));
      router.refresh();
    });
  }

  const info: { label: string; value: ReactNode }[] = [
    { label: t("info.client"), value: share.client?.label ?? t("info.none") },
    { label: t("info.locale"), value: t(`locales.${share.locale}`) },
    {
      label: t("info.expiresAt"),
      value: share.expiresAt ? <DateText value={share.expiresAt} /> : t("info.none"),
    },
    {
      label: t("info.allowDownload"),
      value: share.allowDownload ? t("info.downloadAllowed") : t("info.downloadBlocked"),
    },
    { label: t("info.createdBy"), value: share.createdBy.name },
    {
      label: t("info.createdAt"),
      value: <DateText value={new Date(share.createdAt)} style="short" />,
    },
    {
      label: t("info.lastAccessedAt"),
      value: share.lastAccessedAt ? (
        <DateText value={new Date(share.lastAccessedAt)} style="short" />
      ) : (
        t("info.none")
      ),
    },
  ];
  if (share.revokedAt) {
    info.push({
      label: t("info.revokedAt"),
      value: <DateText value={new Date(share.revokedAt)} style="short" />,
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <Link
            href="/documents/shares"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft aria-hidden className="size-4" />
            {t("back")}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-balance">{share.title}</h1>
            <ShareStatusBadge status={share.status} />
          </div>
          {share.message ? (
            <p className="max-w-prose text-sm text-muted-foreground">{share.message}</p>
          ) : null}
        </div>
        {manageable ? (
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil aria-hidden />
              {t("edit")}
            </Button>
            <Button variant="destructive" onClick={() => setRevokeOpen(true)}>
              <Ban aria-hidden />
              {t("revoke")}
            </Button>
          </div>
        ) : null}
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionCard title={t("link.title")}>
            <div className="flex flex-col gap-6 sm:flex-row">
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <label htmlFor="share-url" className="text-sm font-medium">
                  {t("link.urlLabel")}
                </label>
                <div className="flex gap-2">
                  <Input
                    id="share-url"
                    readOnly
                    value={share.url}
                    className="font-mono text-xs"
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      void copyToClipboard(share.url, {
                        ok: t("link.copied"),
                        failed: t("link.copyFailed"),
                      })
                    }
                  >
                    <Copy aria-hidden />
                    {t("link.copy")}
                  </Button>
                </div>
                {share.status === "ACTIVE" ? (
                  <Button variant="link" className="self-start px-0" asChild>
                    <a href={share.url} target="_blank" rel="noreferrer noopener">
                      <ExternalLink aria-hidden />
                      {t("link.open")}
                    </a>
                  </Button>
                ) : null}
                <dl className="grid gap-x-6 gap-y-3 pt-2 text-sm sm:grid-cols-2">
                  {info.map((item) => (
                    <div key={item.label} className="min-w-0">
                      <dt className="text-muted-foreground">{item.label}</dt>
                      <dd className="font-medium">{item.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <ShareQrCode url={share.url} />
            </div>
          </SectionCard>
        </div>
        <SectionCard title={t("counters.title")} group>
          <StatGrid
            items={[
              { label: t("counters.views"), value: share.counters.viewCount },
              { label: t("counters.downloads"), value: share.counters.downloadCount },
              { label: t("counters.unlocks"), value: share.counters.unlockCount },
              { label: t("counters.failedUnlocks"), value: share.counters.failedUnlockCount },
            ]}
          />
        </SectionCard>
      </div>

      <SectionCard title={t("documents.title")} description={t("documents.description")} group>
        <ShareDocumentsTable
          shareLinkId={share.id}
          documents={share.documents}
          canManageKeys={manageable}
        />
      </SectionCard>

      <SectionCard title={t("accessLog.title")} description={t("accessLog.description")}>
        <ShareAccessLog shareLinkId={share.id} initial={accessLog} />
      </SectionCard>

      <AlertDialog open={revokeOpen} onOpenChange={setRevokeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("revokeConfirm.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("revokeConfirm.description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{tActions("cancel")}</AlertDialogCancel>
            <Button variant="destructive" disabled={pending} onClick={revoke}>
              {t("revokeConfirm.confirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {manageable ? (
        <Sheet open={editOpen} onOpenChange={setEditOpen}>
          <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
            <SheetHeader>
              <SheetTitle>{t("editSheet.title")}</SheetTitle>
              <SheetDescription>{t("editSheet.description")}</SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-6">
              <ShareForm
                idPrefix="edit-share"
                defaults={{
                  title: share.title,
                  message: share.message ?? "",
                  locale: share.locale,
                  expiresAt: share.expiresAt ?? undefined,
                  allowDownload: share.allowDownload,
                }}
                clientId={share.client?.id}
                initialRows={share.documents.map((doc) => editRow(doc, shareableDocuments))}
                submitLabel={t("editSheet.submit")}
                onSubmit={async (input) => {
                  const result = await updateShareLinkAction({ id: share.id, ...input });
                  if (result.ok) {
                    setEditOpen(false);
                    toast.success(t("editSheet.saved"));
                    const keys = oneTimeKeysOf(
                      result.data.generatedKeys,
                      result.data.share.documents,
                    );
                    if (keys.length > 0) setEditKeys(keys);
                    router.refresh();
                  }
                  return result;
                }}
              />
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
      <OneTimeKeysDialog keys={editKeys} onClose={() => setEditKeys(null)} />
    </div>
  );
}

/** A row of the edit form: the document as the link holds it, with its versions when the document is readable. */
function editRow(doc: ShareDocumentDTO, shareable: readonly ShareableDocument[]): ShareFormRow {
  const known = shareable.find((item) => item.id === doc.document.id);
  const fallback: ShareableDocument = {
    id: doc.document.id,
    code: doc.document.code ?? "",
    title: doc.document.label,
    status: doc.documentStatus,
    currentVersionId: null,
    versions:
      doc.versionId && doc.versionNumber
        ? [{ id: doc.versionId, versionNumber: doc.versionNumber }]
        : [],
  };
  return {
    doc: known ?? fallback,
    included: true,
    versionId: doc.versionId,
    requiresAccessKey: doc.requiresAccessKey,
  };
}
