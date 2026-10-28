"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { assignTagsAction } from "@/features/tags/actions";
import { TagPicker } from "@/features/tags/components/tag-picker";
import type { TagChipDTO } from "@/lib/validators/tags";
import { useOpenerFocus } from "./use-opener-focus";

type ClientBulkTagDialogProps = {
  ids: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canCreateTags: boolean;
  onTagged: () => void;
};

/**
 * Adds the chosen tags to every selected client: one `assignTagsAction` per client (no bulk contract), so a
 * client the caller may not update fails on its own and the others still get their tags.
 */
export function ClientBulkTagDialog({
  ids,
  open,
  onOpenChange,
  canCreateTags,
  onTagged,
}: ClientBulkTagDialogProps) {
  const t = useTranslations("clients");
  const tErrors = useTranslations("common.errors");
  const tActions = useTranslations("common.actions");
  const [tags, setTags] = useState<TagChipDTO[]>([]);
  const [pending, setPending] = useState(false);
  useOpenerFocus(open);

  async function apply() {
    setPending(true);
    const tagIds = tags.map((tag) => tag.id);
    const results = await Promise.all(
      ids.map((entityId) => assignTagsAction({ entityType: "CLIENT", entityId, tagIds })),
    );
    setPending(false);
    const failed = results.find((result) => !result.ok);
    const tagged = results.length - results.filter((result) => !result.ok).length;
    if (tagged > 0) toast.success(t("toast.tagged", { count: tagged }));
    if (failed && !failed.ok) toast.error(tErrors(failed.error.code));
    if (tagged === 0) return;
    setTags([]);
    onOpenChange(false);
    onTagged();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("bulk.tagTitle", { count: ids.length })}</DialogTitle>
          <DialogDescription>{t("bulk.tagDescription")}</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="client-bulk-tags">{t("bulk.tagLabel")}</FieldLabel>
          <TagPicker
            id="client-bulk-tags"
            aria-label={t("bulk.tagLabel")}
            value={tags}
            canCreate={canCreateTags}
            onChange={setTags}
          />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {tActions("cancel")}
          </Button>
          <Button
            onClick={() => void apply()}
            disabled={pending || tags.length === 0 || ids.length === 0}
          >
            {t("bulk.tagSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
