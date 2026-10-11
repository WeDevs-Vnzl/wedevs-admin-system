"use client";

import Link from "next/link";
import { useState } from "react";
import { EllipsisIcon, PaperclipIcon, PinIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { DateText } from "@/components/patterns/date-text";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RichTextView } from "@/components/ui/rich-text";
import { getNoteAction } from "@/features/notes/actions";
import { entityHref } from "@/lib/entity-routes";
import type { NoteDetailDTO, NoteListRowDTO } from "@/lib/validators/notes";
import { can, type PermissionSubject } from "@/server/auth/permissions";
import { noteRowTitle } from "../columns";
import { NoteAttachments } from "./note-attachments";

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

export interface NoteCardProps {
  note: NoteListRowDTO;
  viewer: PermissionSubject;
  /** The record whose feed this is: its own link chip is not repeated. */
  currentEntityId?: string;
  onTogglePin?: (note: NoteListRowDTO) => void;
  onEdit?: (note: NoteListRowDTO) => void;
  onArchive?: (note: NoteListRowDTO) => void;
}

/**
 * Card of the notes feed (PRD §8.10, wireframe 4.5): avatar, author · date, pin, title, expandable preview
 * through `RichTextView`, tag chips, linked records and attachments. Actions are filtered with `can()`
 * (cosmetic, C13): a Viewer sees none, a Member can archive only their own notes.
 */
export function NoteCard({
  note,
  viewer,
  currentEntityId,
  onTogglePin,
  onEdit,
  onArchive,
}: NoteCardProps) {
  const t = useTranslations("notes");
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<NoteDetailDTO | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  const canUpdate = can(viewer, "update", "note");
  const canArchive = can(viewer, "delete", "note", { ownerId: note.author.id });
  const hasActions = canUpdate || canArchive;
  const title = noteRowTitle(note) || t("untitled");
  const links = note.links.filter((link) => link.id !== currentEntityId);

  async function toggle() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (detail) return;
    setState("loading");
    const result = await getNoteAction({ id: note.id });
    if (result.ok) {
      setDetail(result.data);
      setState("idle");
    } else {
      setState("error");
    }
  }

  return (
    <article
      data-slot="note-card"
      data-pinned={note.pinned || undefined}
      aria-labelledby={`note-${note.id}-title`}
      className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-xs"
    >
      <header className="flex items-start gap-3">
        <Avatar>
          {note.author.imageUrl ? <AvatarImage src={note.author.imageUrl} alt="" /> : null}
          <AvatarFallback>{initialsOf(note.author.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">
            {note.author.name} · <DateText value={new Date(note.createdAt)} />
          </p>
          <h3 id={`note-${note.id}-title`} className="truncate font-medium">
            {title}
          </h3>
        </div>
        {note.pinned ? (
          <Badge variant="secondary" className="gap-1">
            <PinIcon aria-hidden className="size-3" />
            {t("card.pinned")}
          </Badge>
        ) : null}
        {hasActions ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={t("card.actions")}>
                <EllipsisIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canUpdate ? (
                <DropdownMenuItem onSelect={() => onTogglePin?.(note)}>
                  {note.pinned ? t("card.unpin") : t("card.pin")}
                </DropdownMenuItem>
              ) : null}
              {canUpdate ? (
                <DropdownMenuItem onSelect={() => onEdit?.(note)}>
                  {t("card.edit")}
                </DropdownMenuItem>
              ) : null}
              {canArchive ? (
                <DropdownMenuItem variant="destructive" onSelect={() => onArchive?.(note)}>
                  {t("card.archive")}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </header>

      {expanded ? (
        <div className="flex flex-col gap-3">
          {state === "loading" ? (
            <p className="text-sm text-muted-foreground">{t("card.loadingContent")}</p>
          ) : null}
          {state === "error" ? (
            <p role="alert" className="text-sm text-destructive">
              {t("card.loadContentFailed")}
            </p>
          ) : null}
          {detail ? (
            <>
              <RichTextView content={detail.content} />
              <NoteAttachments files={detail.attachments} />
            </>
          ) : null}
        </div>
      ) : (
        <p className="line-clamp-3 text-sm text-muted-foreground">{note.excerpt}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {note.tags.map((tag) => (
          <Badge key={tag.id} variant="outline" className="gap-1.5 font-normal">
            <span
              aria-hidden
              className="size-2 rounded-full"
              style={{ backgroundColor: tag.color }}
            />
            {tag.name}
          </Badge>
        ))}
        {links.map((link) => {
          const href = entityHref(link);
          return href ? (
            <Badge key={`${link.type}:${link.id}`} variant="secondary" asChild>
              <Link href={href}>{link.label}</Link>
            </Badge>
          ) : (
            <Badge key={`${link.type}:${link.id}`} variant="secondary">
              {link.label}
            </Badge>
          );
        })}
        {!expanded && note.attachmentCount > 0 ? (
          <Badge variant="outline" className="gap-1.5 font-normal">
            <PaperclipIcon aria-hidden className="size-3" />
            {t("card.attachmentCount", { count: note.attachmentCount })}
          </Badge>
        ) : null}
        <Button
          type="button"
          variant="link"
          size="sm"
          className="ml-auto h-auto p-0"
          aria-expanded={expanded}
          onClick={() => void toggle()}
        >
          {expanded ? t("card.collapse") : t("card.expand")}
        </Button>
      </div>
    </article>
  );
}
