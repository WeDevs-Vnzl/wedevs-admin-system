"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TagPicker } from "@/features/tags/components/tag-picker";
import { assignTagsAction } from "@/features/tags/actions";
import { useOpenerFocus } from "@/features/clients/components/use-opener-focus";
import { ProjectArchiveDialog } from "./project-archive-dialog";
import type { TagChipDTO } from "@/lib/validators/tags";

interface ProjectsBulkActionsProps {
  ids: string[];
  canTag: boolean;
  canArchive: boolean;
  /** Whether the tag picker offers the inline "Crear" (`canCreateTagsInline()`, resolved on the server). */
  canCreateTags: boolean;
  /** Called after a bulk change so the table reloads its rows. */
  onDone: () => void;
}

/**
 * Bulk actions of the projects table (PRD §7.3): tag and archive the selected rows. Tagging is one
 * `assignTagsAction` per project (there is no bulk contract); archiving is all-or-none (`INTEGRITY_LOCK`
 * when one project has active billing).
 */
export function ProjectsBulkActions({
  ids,
  canTag,
  canArchive,
  canCreateTags,
  onDone,
}: ProjectsBulkActionsProps) {
  const t = useTranslations("projects.list.bulk");
  const tRoot = useTranslations();
  const tToast = useTranslations("projects.toast");
  const [tagOpen, setTagOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [tags, setTags] = useState<TagChipDTO[]>([]);
  const [saving, setSaving] = useState(false);
  useOpenerFocus(tagOpen);

  async function applyTags() {
    setSaving(true);
    const tagIds = tags.map((tag) => tag.id);
    let failed = 0;
    for (const id of ids) {
      const result = await assignTagsAction({ entityType: "PROJECT", entityId: id, tagIds });
      if (!result.ok) failed += 1;
    }
    setSaving(false);
    if (failed > 0) {
      toast.error(t("tagFailed"));
    } else {
      toast.success(tToast("bulkTagged", { count: ids.length }));
      setTagOpen(false);
      setTags([]);
    }
    onDone();
  }

  return (
    <>
      <Button variant="outline" size="sm" disabled={!canTag} onClick={() => setTagOpen(true)}>
        {t("tag")}
      </Button>
      {canArchive ? (
        <Button variant="outline" size="sm" onClick={() => setArchiveOpen(true)}>
          {t("archive")}
        </Button>
      ) : null}

      <Dialog open={tagOpen} onOpenChange={setTagOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("tagTitle")}</DialogTitle>
            <DialogDescription>{t("tagDescription")}</DialogDescription>
          </DialogHeader>
          <TagPicker
            value={tags}
            onChange={setTags}
            canCreate={canCreateTags}
            aria-label={t("tag")}
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {tRoot("projects.form.cancel")}
              </Button>
            </DialogClose>
            <Button
              type="button"
              disabled={saving || tags.length === 0}
              onClick={() => void applyTags()}
            >
              {t("tagSave")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ProjectArchiveDialog
        ids={ids}
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        description={t("archiveDescription", { count: ids.length })}
        onArchived={onDone}
      />
    </>
  );
}
