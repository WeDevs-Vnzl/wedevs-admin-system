"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PinIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { DateText } from "@/components/patterns/date-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RichTextView } from "@/components/ui/rich-text";
import { archiveNoteAction, linkNoteAction, unlinkNoteAction } from "@/features/notes/actions";
import { TagChips } from "@/features/tags/components/tag-chips";
import { entityHref } from "@/lib/entity-routes";
import { noteDisplayTitle } from "@/lib/rich-text";
import type { ActionError } from "@/lib/validators/common";
import type { NoteDetailDTO } from "@/lib/validators/notes";
import { NoteAttachments } from "./note-attachments";
import { NoteComposerPage } from "./note-composer";
import { NoteLinkPicker, toNoteLinkRef, type NoteLinkRef } from "./note-link-picker";

export interface NoteDetailProps {
  note: NoteDetailDTO;
  /** `can(viewer, "update", "note")`: the form and the link editor. A Viewer reads the note only. */
  canUpdate: boolean;
  /** `can(viewer, "delete", "note", { ownerId })`: the own-notes rule, computed on the server. */
  canArchive: boolean;
  /** `can(viewer, "create", "note")`: inline creation of tags in the form. */
  canCreateTags: boolean;
}

/**
 * `/notes/[id]`: the note's header (title, author, pin, archive), its editable form, its attachments and its
 * links. Links go through `linkNoteAction` / `unlinkNoteAction` at once; the service keeps the last link, and its
 * `INTEGRITY_LOCK` answer is shown as the guard message.
 */
export function NoteDetail({ note: initial, canUpdate, canArchive, canCreateTags }: NoteDetailProps) {
  const t = useTranslations("notes");
  const tRoot = useTranslations();
  const router = useRouter();
  const [note, setNote] = useState(initial);
  const [linkPending, setLinkPending] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [archivePending, setArchivePending] = useState(false);

  const title = noteDisplayTitle(note.title, note.content) || t("untitled");
  const links = note.links.flatMap((ref) => toNoteLinkRef(ref) ?? []);

  /** The service's message key when it sends one (the last-link guard), else the code's message. */
  function errorMessage(error: ActionError): string {
    if (error.message && tRoot.has(error.message as never)) return tRoot(error.message as never);
    return t("toast.error");
  }

  async function addLink(link: NoteLinkRef) {
    setLinkPending(true);
    setLinkError(null);
    const result = await linkNoteAction({
      noteId: note.id,
      target: { entityType: link.type, entityId: link.id },
    });
    setLinkPending(false);
    if (!result.ok) {
      setLinkError(errorMessage(result.error));
      return;
    }
    setNote(result.data);
    toast.success(t("toast.linkAdded"));
  }

  async function removeLink(link: NoteLinkRef) {
    setLinkPending(true);
    setLinkError(null);
    const result = await unlinkNoteAction({
      noteId: note.id,
      target: { entityType: link.type, entityId: link.id },
    });
    setLinkPending(false);
    if (!result.ok) {
      setLinkError(errorMessage(result.error));
      return;
    }
    setNote(result.data);
    toast.success(t("toast.linkRemoved"));
  }

  async function archive() {
    setArchivePending(true);
    const result = await archiveNoteAction({ id: note.id });
    setArchivePending(false);
    setArchiving(false);
    if (!result.ok) {
      toast.error(t("toast.error"));
      return;
    }
    toast.success(t("toast.archived"));
    router.push("/notes");
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Link href="/notes" className="text-sm text-muted-foreground hover:underline">
            {t("detail.back")}
          </Link>
          <h1 className="truncate text-2xl font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">
            {note.author.name} · <DateText value={new Date(note.createdAt)} />
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {note.pinned ? (
            <Badge variant="secondary" className="gap-1">
              <PinIcon aria-hidden className="size-3" />
              {t("card.pinned")}
            </Badge>
          ) : null}
          {canArchive ? (
            <Button variant="outline" onClick={() => setArchiving(true)}>
              {t("card.archive")}
            </Button>
          ) : null}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {canUpdate ? (
            <NoteComposerPage
              note={note}
              canCreateTags={canCreateTags}
              onSaved={(saved) => setNote(saved)}
            />
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">{t("detail.readOnly")}</p>
              <RichTextView content={note.content} />
              <TagChips tags={note.tags} />
            </div>
          )}
          <NoteAttachments files={note.attachments} />
        </div>

        <aside aria-labelledby="note-links-title" className="flex flex-col gap-3">
          <h2 id="note-links-title" className="text-sm font-medium">
            {t("detail.linksTitle")}
          </h2>
          {canUpdate ? (
            <NoteLinkPicker
              value={links}
              onAdd={(link) => void addLink(link)}
              onRemove={(link) => void removeLink(link)}
              disabled={linkPending}
            />
          ) : (
            <ul className="flex flex-wrap gap-2">
              {links.map((link) => {
                const href = entityHref(link);
                return (
                  <li key={`${link.type}:${link.id}`}>
                    <Badge variant="secondary" asChild={Boolean(href)}>
                      {href ? <Link href={href}>{link.label}</Link> : link.label}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
          {linkError ? (
            <p role="alert" className="text-sm text-destructive">
              {linkError}
            </p>
          ) : null}
        </aside>
      </div>

      <ConfirmDialog
        variant="archive"
        open={archiving}
        onOpenChange={(open) => {
          if (!open) setArchiving(false);
        }}
        onConfirm={() => void archive()}
        pending={archivePending}
      />
    </div>
  );
}
