"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { DateText } from "@/components/patterns/date-text";
import { StatusBadge } from "@/components/patterns/status-badge";
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
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AccessKeyAction, ShareDocumentDTO } from "@/lib/validators/shares";
import { setShareDocumentAccessKeyAction } from "../actions";
import type { OneTimeAccessKey } from "../types";
import { OneTimeKeysDialog } from "./one-time-keys-dialog";

interface ShareDocumentsTableProps {
  shareLinkId: string;
  documents: readonly ShareDocumentDTO[];
  /** Shows the key controls (Owner/Admin on a link that is not revoked). */
  canManageKeys: boolean;
}

type PendingConfirm = { action: "regenerate" | "remove"; doc: ShareDocumentDTO } | null;

/**
 * Documents of a link: version pin ("always the latest" or a pinned version), status, per-document counters and the
 * access key (DT-45). Turning the key on generates it; regenerating or removing asks first. A new key is shown
 * once in `OneTimeKeysDialog` and dropped when that dialog closes.
 */
export function ShareDocumentsTable({
  shareLinkId,
  documents,
  canManageKeys,
}: ShareDocumentsTableProps) {
  const t = useTranslations("shares.detail");
  const tActions = useTranslations("common.actions");
  const router = useRouter();
  const [confirm, setConfirm] = useState<PendingConfirm>(null);
  const [oneTimeKey, setOneTimeKey] = useState<OneTimeAccessKey[] | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: AccessKeyAction, doc: ShareDocumentDTO) {
    startTransition(async () => {
      const result = await setShareDocumentAccessKeyAction({
        shareLinkId,
        documentId: doc.document.id,
        action,
      });
      setConfirm(null);
      if (!result.ok) {
        toast.error(t("keys.failed"));
        return;
      }
      if (result.data.accessKey) {
        setOneTimeKey([
          {
            documentId: doc.document.id,
            documentTitle: doc.document.label,
            accessKey: result.data.accessKey,
          },
        ]);
      } else {
        toast.success(t("keys.removed"));
      }
      router.refresh();
    });
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("documents.columns.document")}</TableHead>
            <TableHead>{t("documents.columns.status")}</TableHead>
            <TableHead>{t("documents.columns.version")}</TableHead>
            <TableHead>{t("documents.columns.accessKey")}</TableHead>
            <TableHead className="text-right">{t("documents.columns.activity")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {documents.map((doc) => (
            <TableRow key={doc.document.id}>
              <TableCell>
                <Link
                  href={`/documents/${doc.document.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {doc.document.label}
                </Link>
                {doc.document.code ? (
                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                    {doc.document.code}
                  </span>
                ) : null}
              </TableCell>
              <TableCell>
                <StatusBadge enumName="DocumentStatus" value={doc.documentStatus} />
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {doc.versionId === null
                  ? doc.versionNumber
                    ? t("documents.latest", { number: doc.versionNumber })
                    : t("documents.latestNoVersion")
                  : t("documents.pinned", { number: doc.versionNumber ?? 0 })}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  {canManageKeys ? (
                    <Switch
                      aria-label={t("documents.toggleKey", { title: doc.document.label })}
                      checked={doc.requiresAccessKey}
                      disabled={pending}
                      onCheckedChange={(on) => {
                        if (on) run("generate", doc);
                        else setConfirm({ action: "remove", doc });
                      }}
                    />
                  ) : null}
                  <span className="text-xs text-muted-foreground">
                    {doc.requiresAccessKey && doc.accessKeyUpdatedAt ? (
                      <>
                        {t("documents.keySince")}{" "}
                        <DateText value={new Date(doc.accessKeyUpdatedAt)} style="short" />
                      </>
                    ) : doc.requiresAccessKey ? null : (
                      t("documents.noKey")
                    )}
                  </span>
                  {canManageKeys && doc.requiresAccessKey ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      aria-label={t("documents.regenerate", { title: doc.document.label })}
                      onClick={() => setConfirm({ action: "regenerate", doc })}
                    >
                      <RefreshCw aria-hidden />
                      {t("documents.regenerateShort")}
                    </Button>
                  ) : null}
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {t("documents.activity", {
                  views: doc.counters.viewCount,
                  downloads: doc.counters.downloadCount,
                  failed: doc.counters.failedUnlockCount,
                })}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => (open ? null : setConfirm(null))}
      >
        <AlertDialogContent>
          {confirm ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{t(`keys.${confirm.action}Confirm.title`)}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t(`keys.${confirm.action}Confirm.description`, {
                    title: confirm.doc.document.label,
                  })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={pending}>{tActions("cancel")}</AlertDialogCancel>
                <Button
                  type="button"
                  variant={confirm.action === "remove" ? "destructive" : "default"}
                  disabled={pending}
                  onClick={() => run(confirm.action, confirm.doc)}
                >
                  {t(`keys.${confirm.action}Confirm.confirm`)}
                </Button>
              </AlertDialogFooter>
            </>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>

      <OneTimeKeysDialog keys={oneTimeKey} onClose={() => setOneTimeKey(null)} />
    </>
  );
}
