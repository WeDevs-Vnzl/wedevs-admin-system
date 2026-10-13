"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArchivedBanner } from "@/components/patterns/archived-banner";
import { DetailHeader } from "@/components/patterns/detail-header";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { TagChips } from "@/features/tags/components/tag-chips";
import { restoreClientAction } from "@/features/clients/actions";
import { entityHref } from "@/lib/entity-routes";
import type { ClientKind, ClientStatus } from "@/lib/validators/enums";
import type { TagChipDTO } from "@/lib/validators/tags";
import { ClientArchiveDialog } from "./client-archive-dialog";
import type { ClientScreenPermissions } from "./client-permissions";
import { ClientStatusDialog } from "./client-status-dialog";

type ClientDetailHeaderProps = {
  client: {
    id: string;
    code: string;
    tradeName: string;
    kind: ClientKind;
    country: string;
    status: ClientStatus;
    tags: TagChipDTO[];
    archivedAt: string | null;
  };
  permissions: Pick<ClientScreenPermissions, "canUpdate" | "canArchive" | "canRestore">;
};

/** Two initials from the trade name ("Kairos Studio" → "KS"). */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (
    words.length > 1 ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}` : name.slice(0, 2)
  ).toUpperCase();
}

/**
 * Header of a client detail: initials, code, name, status, tags and meta, the Detalle | Grafo toggle, Edit,
 * and the More menu (status, archive). The dialogs stay outside the menu so closing it cannot unmount them.
 * Archived clients show the banner with Restore (Owner and Admin, C19).
 */
export function ClientDetailHeader({ client, permissions }: ClientDetailHeaderProps) {
  const t = useTranslations("clients");
  const tEnums = useTranslations("enums");
  const tRoot = useTranslations();
  const tErrors = useTranslations("common.errors");
  const router = useRouter();
  const [statusOpen, setStatusOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const archived = client.archivedAt !== null;

  async function restore() {
    setRestoring(true);
    const result = await restoreClientAction({ id: client.id });
    setRestoring(false);
    if (!result.ok) {
      const { error } = result;
      if (error.code === "CONFLICT" && error.entity) {
        const href = entityHref({ type: error.entity.type, id: error.entity.id });
        toast.error(tRoot(error.message as never), {
          action: href
            ? { label: t("detail.restoreConflictAction"), onClick: () => router.push(href) }
            : undefined,
        });
        return;
      }
      toast.error(tErrors(error.code));
      return;
    }
    toast.success(t("toast.restored"));
    router.refresh();
  }

  return (
    <>
      <DetailHeader
        backHref="/clients/list"
        icon={
          <Avatar
            className="size-12 rounded-2xl"
            aria-label={t("detail.avatarLabel", { name: client.tradeName })}
          >
            <AvatarFallback className="rounded-2xl">{initialsOf(client.tradeName)}</AvatarFallback>
          </Avatar>
        }
        code={client.code}
        name={client.tradeName}
        status={<StatusBadge enumName="ClientStatus" value={client.status} />}
        tags={client.tags.length > 0 ? <TagChips tags={client.tags} /> : null}
        meta={`${tEnums(`ClientKind.${client.kind}`)} · ${client.country}`}
        mode="detail"
        detailHref={`/clients/${client.id}`}
        graphHref={`/clients/${client.id}/graph`}
        actions={
          permissions.canUpdate ? (
            <Button variant="outline" asChild>
              <Link href={`/clients/${client.id}/edit`}>{t("detail.actions.edit")}</Link>
            </Button>
          ) : null
        }
        moreActions={
          (permissions.canUpdate && !archived) || (permissions.canArchive && !archived) ? (
            <>
              {permissions.canUpdate && !archived ? (
                <DropdownMenuItem onSelect={() => setStatusOpen(true)}>
                  {t("detail.actions.changeStatus")}
                </DropdownMenuItem>
              ) : null}
              {permissions.canArchive && !archived ? (
                <DropdownMenuItem variant="destructive" onSelect={() => setArchiveOpen(true)}>
                  {t("detail.actions.archive")}
                </DropdownMenuItem>
              ) : null}
            </>
          ) : undefined
        }
      />

      {archived ? (
        <ArchivedBanner
          onRestore={permissions.canRestore ? () => void restore() : undefined}
          pending={restoring}
        />
      ) : null}

      {permissions.canUpdate && !archived ? (
        <ClientStatusDialog
          clientId={client.id}
          current={client.status}
          open={statusOpen}
          onOpenChange={setStatusOpen}
          onChanged={() => router.refresh()}
        />
      ) : null}

      {permissions.canArchive && !archived ? (
        <ClientArchiveDialog
          ids={[client.id]}
          open={archiveOpen}
          onOpenChange={setArchiveOpen}
          onArchived={() => router.refresh()}
        />
      ) : null}
    </>
  );
}
