"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PlusIcon, StickyNoteIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { EmptyState } from "@/components/patterns/empty-state";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  archiveNoteAction,
  getNoteAction,
  listNotesAction,
  pinNoteAction,
} from "@/features/notes/actions";
import type { Paginated } from "@/lib/validators/common";
import type { NoteDetailDTO, NoteListRowDTO } from "@/lib/validators/notes";
import { can, type PermissionSubject } from "@/server/auth/permissions";
import { NoteCard } from "./note-card";
import { NoteComposer, type NoteLinkRef } from "./note-composer";

export const NOTES_FEED_PAGE_SIZE = 25;

export interface NotesFeedProps {
  /** First page of the feed (server-rendered). */
  initial: Paginated<NoteListRowDTO>;
  /** The record the feed belongs to: filters the list and pre-links new notes. */
  entity: NoteLinkRef;
  viewer: PermissionSubject;
}

/**
 * Feed of the notes of one record (PRD §8.10): "+ Nueva nota" (pre-linked, only when `can()` allows it), the
 * cards (pinned first, then newest), "Cargar más" and the empty state. A Viewer sees no write action.
 */
export function NotesFeed({ initial, entity, viewer }: NotesFeedProps) {
  const t = useTranslations("notes");
  const router = useRouter();
  const [source, setSource] = useState(initial);
  const [feed, setFeed] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [composer, setComposer] = useState<{ open: boolean; note?: NoteDetailDTO }>({
    open: false,
  });
  const [archiving, setArchiving] = useState<NoteListRowDTO | null>(null);
  const [pending, setPending] = useState(false);

  // A server refresh hands over a new first page: adopt it.
  if (source !== initial) {
    setSource(initial);
    setFeed(initial);
  }

  const canCreate = can(viewer, "create", "note");
  const filter = { entityType: entity.type, entityId: entity.id, pageSize: NOTES_FEED_PAGE_SIZE };

  async function loadMore() {
    setLoading(true);
    setFailed(false);
    const result = await listNotesAction({ ...filter, page: feed.page + 1 });
    setLoading(false);
    if (!result.ok) {
      setFailed(true);
      return;
    }
    setFeed((current) => ({ ...result.data, items: [...current.items, ...result.data.items] }));
  }

  /** Re-reads every page already shown, so a pin or an archive reorders the list in place. */
  async function reload() {
    const pages = feed.page;
    let latest: Paginated<NoteListRowDTO> | null = null;
    const items: NoteListRowDTO[] = [];
    for (let page = 1; page <= pages; page += 1) {
      const result = await listNotesAction({ ...filter, page });
      if (!result.ok) return router.refresh();
      latest = result.data;
      items.push(...result.data.items);
    }
    if (latest) setFeed({ ...latest, items });
    router.refresh();
  }

  async function togglePin(note: NoteListRowDTO) {
    const result = await pinNoteAction({ id: note.id, pinned: !note.pinned });
    if (!result.ok) return void toast.error(t("toast.error"));
    toast.success(note.pinned ? t("toast.unpinned") : t("toast.pinned"));
    await reload();
  }

  async function edit(note: NoteListRowDTO) {
    const result = await getNoteAction({ id: note.id });
    if (!result.ok) return void toast.error(t("toast.error"));
    setComposer({ open: true, note: result.data });
  }

  async function archive() {
    if (!archiving) return;
    setPending(true);
    const result = await archiveNoteAction({ id: archiving.id });
    setPending(false);
    setArchiving(null);
    if (!result.ok) return void toast.error(t("toast.error"));
    toast.success(t("toast.archived"));
    await reload();
  }

  return (
    <TooltipProvider>
      <section aria-label={t("feed.label")} className="flex flex-col gap-4">
        {canCreate ? (
          <div className="flex justify-end">
            <Button type="button" onClick={() => setComposer({ open: true })}>
              <PlusIcon aria-hidden />
              {t("tab.newNote")}
            </Button>
          </div>
        ) : null}

        {feed.items.length === 0 ? (
          <EmptyState
            icon={StickyNoteIcon}
            title={t("feed.emptyTitle")}
            description={
              canCreate ? t("feed.emptyDescription") : t("feed.emptyDescriptionReadOnly")
            }
            action={
              canCreate ? (
                <Button type="button" onClick={() => setComposer({ open: true })}>
                  <PlusIcon aria-hidden />
                  {t("tab.newNote")}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {feed.items.map((note) => (
              <li key={note.id}>
                <NoteCard
                  note={note}
                  viewer={viewer}
                  currentEntityId={entity.id}
                  onTogglePin={(target) => void togglePin(target)}
                  onEdit={(target) => void edit(target)}
                  onArchive={setArchiving}
                />
              </li>
            ))}
          </ul>
        )}

        {failed ? (
          <p role="alert" className="text-sm text-destructive">
            {t("feed.loadFailed")}
          </p>
        ) : null}
        {feed.page < feed.pageCount ? (
          <div className="flex justify-center">
            <Button
              type="button"
              variant="outline"
              disabled={loading}
              onClick={() => void loadMore()}
            >
              {loading ? t("feed.loading") : t("feed.loadMore")}
            </Button>
          </div>
        ) : null}
      </section>

      {canCreate || composer.note ? (
        <NoteComposer
          open={composer.open}
          onOpenChange={(open) => setComposer((current) => ({ ...current, open }))}
          links={[entity]}
          canCreateTags={canCreate}
          {...(composer.note ? { note: composer.note } : {})}
          onSaved={() => void reload()}
        />
      ) : null}
      <ConfirmDialog
        variant="archive"
        open={archiving !== null}
        onOpenChange={(open) => {
          if (!open) setArchiving(null);
        }}
        onConfirm={() => void archive()}
        pending={pending}
      />
    </TooltipProvider>
  );
}
