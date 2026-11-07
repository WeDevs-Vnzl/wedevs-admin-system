"use client";

import { KeyRound, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { DateText } from "@/components/patterns/date-text";
import { EmptyState } from "@/components/patterns/empty-state";
import { PageHeader } from "@/components/patterns/page-header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useApiClient } from "@/lib/api/client";
import type { ApiTokenListItem, IssuedApiTokenDto } from "@/lib/api/types/api-tokens";
import { API_TOKEN_MAX_ACTIVE, apiTokenMessageKey, revokeApiToken } from "../api";
import { CreateTokenDialog } from "./create-token-dialog";
import { SecretDialog } from "./secret-dialog";

type ApiTokensViewProps = {
  initialTokens: readonly ApiTokenListItem[];
};

type TokenStatus = "active" | "revoked" | "expired";

function statusOf(token: ApiTokenListItem, now: number): TokenStatus {
  if (token.revokedAt) return "revoked";
  return new Date(token.expiresAt).getTime() <= now ? "expired" : "active";
}

/** The list row of an issued token: everything but the secret, which never enters the list state. */
function toListItem(issued: IssuedApiTokenDto): ApiTokenListItem {
  return {
    id: issued.id,
    name: issued.name,
    prefix: issued.prefix,
    createdAt: issued.createdAt,
    expiresAt: issued.expiresAt,
    lastUsedAt: issued.lastUsedAt,
    revokedAt: issued.revokedAt,
  };
}

// Settings → Tokens de API (DT-189): own personal access tokens. The list comes from the server render; issuing
// and revoking call the API from the browser, so a new secret goes straight from the BE to the secret dialog.
export function ApiTokensView({ initialTokens }: ApiTokensViewProps) {
  const t = useTranslations("apiTokens");
  const tRoot = useTranslations();
  const router = useRouter();
  const api = useApiClient();
  const [tokens, setTokens] = useState<readonly ApiTokenListItem[]>(initialTokens);
  const [createOpen, setCreateOpen] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiTokenListItem | null>(null);
  const [revoking, setRevoking] = useState(false);
  // Read once per mount: expiry only changes the badge, and render stays pure.
  const [now] = useState(() => Date.now());

  function handleIssued(issued: IssuedApiTokenDto) {
    setTokens((current) => [toListItem(issued), ...current]);
    setSecret(issued.secret);
  }

  async function confirmRevoke() {
    if (!revokeTarget) return;
    setRevoking(true);
    const result = await revokeApiToken(api, revokeTarget.id);
    setRevoking(false);
    if (!result.ok) {
      if (result.error.redirectTo) router.push(result.error.redirectTo);
      toast.error(
        tRoot(
          apiTokenMessageKey(
            result.error.message,
            tRoot.has,
            `common.errors.${result.error.code}`,
          ) as never,
        ),
      );
      setRevokeTarget(null);
      return;
    }
    const revoked = result.data;
    setTokens((current) =>
      current.map((token) =>
        token.id === revoked.id ? { ...token, revokedAt: revoked.revokedAt } : token,
      ),
    );
    setRevokeTarget(null);
    toast.success(t("toast.revoked"));
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("page.title")}
        description={`${t("page.description")} ${t("limit", { max: API_TOKEN_MAX_ACTIVE })}`}
        actions={
          <Button type="button" onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden />
            {t("actions.create")}
          </Button>
        }
      />

      {tokens.length === 0 ? (
        <EmptyState icon={KeyRound} title={t("empty.title")} description={t("empty.description")} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.name")}</TableHead>
              <TableHead>{t("columns.prefix")}</TableHead>
              <TableHead>{t("columns.createdAt")}</TableHead>
              <TableHead>{t("columns.expiresAt")}</TableHead>
              <TableHead>{t("columns.lastUsedAt")}</TableHead>
              <TableHead>{t("columns.status")}</TableHead>
              <TableHead className="text-right">{t("columns.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tokens.map((token) => {
              const status = statusOf(token, now);
              return (
                <TableRow key={token.id}>
                  <TableCell className="font-medium">{token.name}</TableCell>
                  <TableCell className="font-mono text-xs">{token.prefix}…</TableCell>
                  <TableCell>
                    <DateText value={new Date(token.createdAt)} />
                  </TableCell>
                  <TableCell>
                    <DateText value={new Date(token.expiresAt)} />
                  </TableCell>
                  <TableCell>
                    {token.lastUsedAt ? (
                      <DateText value={new Date(token.lastUsedAt)} />
                    ) : (
                      <span className="text-muted-foreground">{t("lastUsed.never")}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={status === "active" ? "secondary" : "outline"}>
                      {t(`status.${status}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {status === "active" ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={t("actions.revoke", { name: token.name })}
                        onClick={() => setRevokeTarget(token)}
                      >
                        {t("revoke.confirm")}
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <CreateTokenDialog open={createOpen} onOpenChange={setCreateOpen} onIssued={handleIssued} />
      <SecretDialog secret={secret} onClose={() => setSecret(null)} />

      <AlertDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open && !revoking) setRevokeTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("revoke.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("revoke.description", { name: revokeTarget?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoking}>{t("revoke.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={revoking}
              onClick={(event) => {
                event.preventDefault();
                void confirmRevoke();
              }}
            >
              {t("revoke.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
