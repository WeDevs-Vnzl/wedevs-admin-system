"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Pencil, Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TagChips } from "@/features/tags/components/tag-chips";
import { useOpenerFocus } from "@/features/clients/components/use-opener-focus";
import { archiveContactAction, setPrimaryContactAction } from "@/features/contacts/actions";
import type { ContactListRowDTO } from "@/lib/validators/contacts";
import { ContactFormDialog } from "./contact-form-dialog";

type ContactsTableProps = {
  clientId: string;
  /** Live contacts of the client, primary first (the server sorts them). */
  contacts: ContactListRowDTO[];
  /** Owner and Admin; Member and Viewer read the list only (HU-04, PRD §4.3). */
  canManage: boolean;
  /** Inline "Crear" in the tag picker of the contact form (R13). */
  canCreateTags: boolean;
};

type Dialog =
  | { kind: "form"; contact?: ContactListRowDTO; open: boolean; key: number }
  | { kind: "archive"; contact: ContactListRowDTO; open: boolean }
  | null;

/**
 * The client's *Contactos* tab (HU-04): a table with add/edit, the primary toggle (CA2: the previous primary is
 * demoted by the server) and archive. Rows come from the server, so each mutation refreshes the route.
 */
export function ContactsTable({
  clientId,
  contacts,
  canManage,
  canCreateTags,
}: ContactsTableProps) {
  const t = useTranslations("contacts");
  const tErrors = useTranslations("common.errors");
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  useOpenerFocus(dialog?.open === true && dialog.kind === "archive");

  const refresh = () => router.refresh();

  async function makePrimary(contact: ContactListRowDTO) {
    setPendingId(contact.id);
    const result = await setPrimaryContactAction({ id: contact.id });
    setPendingId(null);
    if (!result.ok) {
      toast.error(tErrors(result.error.code));
      return;
    }
    toast.success(t("toast.primaryChanged"));
    refresh();
  }

  async function archive(contact: ContactListRowDTO) {
    setPendingId(contact.id);
    const result = await archiveContactAction({ id: contact.id });
    setPendingId(null);
    if (!result.ok) {
      toast.error(tErrors(result.error.code));
      return;
    }
    toast.success(t("toast.archived"));
    setDialog(null);
    refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {canManage ? (
        <div className="flex justify-end">
          <Button onClick={() => setDialog({ kind: "form", open: true, key: Date.now() })}>
            <Plus aria-hidden />
            {t("actions.new")}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("tab.readOnly")}</p>
      )}

      {contacts.length === 0 ? (
        <div className="rounded-2xl border p-8 text-center">
          <p className="font-medium">{t("empty.title")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("empty.description")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.fullName")}</TableHead>
                <TableHead>{t("columns.position")}</TableHead>
                <TableHead>{t("columns.email")}</TableHead>
                <TableHead>{t("columns.phone")}</TableHead>
                <TableHead>{t("columns.primary")}</TableHead>
                <TableHead>{t("columns.tags")}</TableHead>
                {canManage ? (
                  <TableHead className="text-right">{t("columns.actions")}</TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.map((contact) => {
                const busy = pendingId === contact.id;
                return (
                  <TableRow key={contact.id}>
                    <TableCell className="font-medium">{contact.fullName}</TableCell>
                    <TableCell>{contact.position ?? "—"}</TableCell>
                    <TableCell className="break-all">{contact.email ?? "—"}</TableCell>
                    <TableCell className="tabular-nums">{contact.phone ?? "—"}</TableCell>
                    <TableCell>
                      {contact.isPrimary ? (
                        <span className="text-sm font-medium">{t("actions.primary")}</span>
                      ) : canManage ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => void makePrimary(contact)}
                        >
                          <Star aria-hidden />
                          {t("actions.setPrimary")}
                        </Button>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {contact.tags.length > 0 ? <TagChips tags={contact.tags} /> : null}
                    </TableCell>
                    {canManage ? (
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("actions.edit", { name: contact.fullName })}
                            disabled={busy}
                            onClick={() =>
                              setDialog({ kind: "form", contact, open: true, key: Date.now() })
                            }
                          >
                            <Pencil aria-hidden />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("actions.archive", { name: contact.fullName })}
                            disabled={busy}
                            onClick={() => setDialog({ kind: "archive", contact, open: true })}
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {canManage && dialog?.kind === "form" ? (
        <ContactFormDialog
          key={dialog.key}
          clientId={clientId}
          contact={dialog.contact}
          open={dialog.open}
          onOpenChange={(open) =>
            setDialog((current) => (current?.kind === "form" ? { ...current, open } : current))
          }
          canCreateTags={canCreateTags}
          onSaved={refresh}
        />
      ) : null}

      {canManage && dialog?.kind === "archive" ? (
        <ConfirmDialog
          variant="archive"
          open={dialog.open}
          onOpenChange={(open) =>
            setDialog((current) => (current?.kind === "archive" ? { ...current, open } : current))
          }
          pending={pendingId !== null}
          onConfirm={() => {
            if (dialog.kind === "archive") void archive(dialog.contact);
          }}
        />
      ) : null}
    </div>
  );
}
