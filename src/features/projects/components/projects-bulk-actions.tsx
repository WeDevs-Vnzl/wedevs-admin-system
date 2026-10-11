"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
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
import { archiveProjectsAction } from "@/features/projects/actions";
import type { TagChipDTO } from "@/lib/validators/tags";

interface ProjectsBulkActionsProps {
  ids: string[];
  canTag: boolean;
  canArchive: boolean;
  /** Called after a bulk change so the table reloads its rows. */
  onDone: () => void;
}

/**
 * Bulk actions of the projects table (PRD §7.3): tag and archive the selected rows. Tagging is one
 * `assignTagsAction` per project (there is no bulk contract); archiving is all-or-none (`INTEGRITY_LOCK`
 * when one project has active billing).
 */
export function ProjectsBulkActions({ ids, canTag, canArchive, onDone }: ProjectsBulkActionsProps) {
  const t = useTranslations("projects.list.bulk");
  const tRoot = useTranslations();
  const tToast = useTranslations("projects.toast");
  const [tagOpen, setTagOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [tags, setTags] = useState<TagChipDTO[]>([]);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState(false);

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

  async function archive() {
    setPending(true);
    const result = await archiveProjectsAction({ ids, confirm: true });
    setPending(false);
    if (!result.ok) {
      toast.error(tRoot(`common.errors.${result.error.code}` as never));
      return;
    }
    toast.success(tToast("bulkArchived", { count: ids.length }));
    setArchiveOpen(false);
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
          <TagPicker value={tags} onChange={setTags} canCreate={false} aria-label={t("tag")} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {tRoot("projects.form.cancel")}
              </Button>
            </DialogClose>
            <Button type="button" disabled={saving || tags.length === 0} onClick={() => void applyTags()}>
              {t("tagSave")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        variant="archive"
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        description={t("archiveDescription", { count: ids.length })}
        pending={pending}
        onConfirm={() => void archive()}
      />
    </>
  );
}
