"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Pencil, Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  createDataTableColumnHelper,
  type DataTableColumnDef,
} from "@/components/ui/data-table";
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

const helper = createDataTableColumnHelper<ContactListRowDTO>();
const dash = (value: string | null) => value ?? "—";

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

  const columns: DataTableColumnDef<ContactListRowDTO>[] = [
    helper.accessor("fullName", {
      header: t("columns.fullName"),
      cell: ({ getValue }) => <span className="font-medium">{getValue()}</span>,
      meta: { label: t("columns.fullName"), pinned: true },
      size: 200,
    }),
    helper.accessor("position", {
      header: t("columns.position"),
      cell: ({ getValue }) => dash(getValue()),
      meta: { label: t("columns.position") },
      size: 160,
    }),
    helper.accessor("email", {
      header: t("columns.email"),
      cell: ({ getValue }) => dash(getValue()),
      meta: { label: t("columns.email") },
      size: 220,
    }),
    helper.accessor("phone", {
      header: t("columns.phone"),
      cell: ({ getValue }) => <span className="tabular-nums">{dash(getValue())}</span>,
      meta: { label: t("columns.phone") },
      size: 150,
    }),
    helper.display({
      id: "primary",
      header: t("columns.primary"),
      cell: ({ row }) => {
        const contact = row.original;
        if (contact.isPrimary) {
          return <span className="text-sm font-medium">{t("actions.primary")}</span>;
        }
        return canManage ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={pendingId === contact.id}
            onClick={() => void makePrimary(contact)}
          >
            <Star aria-hidden />
            {t("actions.setPrimary")}
          </Button>
        ) : null;
      },
      meta: { label: t("columns.primary") },
      size: 170,
    }),
    helper.display({
      id: "tags",
      header: t("columns.tags"),
      cell: ({ row }) =>
        row.original.tags.length > 0 ? <TagChips tags={row.original.tags} /> : null,
      meta: { label: t("columns.tags"), wrap: true },
      size: 200,
    }),
    ...(canManage
      ? [
          helper.display({
            id: "actions",
            header: t("columns.actions"),
            cell: ({ row }) => {
              const contact = row.original;
              const busy = pendingId === contact.id;
              return (
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
              );
            },
            meta: {
              label: t("columns.actions"),
              hideable: false,
              exportable: false,
              align: "end" as const,
            },
            size: 110,
          }),
        ]
      : []),
  ];

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

      <DataTable
        variant="compact"
        data={contacts}
        columns={columns}
        getRowId={(row) => row.id}
        emptyState={{ title: t("empty.title"), description: t("empty.description") }}
      />

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
