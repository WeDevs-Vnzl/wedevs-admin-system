"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AsyncCombobox, type AsyncComboboxOption } from "@/components/ui/async-combobox";
import { createTagAction, listTagsAction } from "@/features/tags/actions";
import type { TagChipDTO, TagListRowDTO } from "@/lib/validators/tags";
import { PRESET_TAG_COLORS } from "./color-swatches";
import { TagChips } from "./tag-chips";

/** Colour given to a tag created inline; the Settings screen recolours it later. */
const INLINE_TAG_COLOR = PRESET_TAG_COLORS[4];
/** Options loaded per search; the catalogue is small, so the picker never pages. */
const PICKER_PAGE_SIZE = 50;

type TagPickerProps = {
  value: TagChipDTO[];
  onChange: (next: TagChipDTO[]) => void;
  /** Inline "Crear «…»" only when the user may create tags (the caller decides); off otherwise. */
  canCreate?: boolean;
  disabled?: boolean;
  id?: string;
  placeholder?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
};

/**
 * Multi-select of tags with colour chips (PRD §7.4 "tags multi-select with inline creation"). The combobox
 * kit shows neutral chips while selecting; the coloured chips of the selection sit under it.
 */
export function TagPicker({ value, onChange, canCreate = false, ...props }: TagPickerProps) {
  const t = useTranslations("tags");
  const tErrors = useTranslations("common.errors");
  // Colours of the tags seen so far, by id: combobox options carry no colour.
  const known = useRef(new Map<string, TagChipDTO>());

  function remember(tag: TagChipDTO) {
    known.current.set(tag.id, { id: tag.id, name: tag.name, color: tag.color });
  }

  function toOption(
    tag: Pick<TagListRowDTO, "id" | "name"> & { usageCount?: number },
  ): AsyncComboboxOption {
    return {
      value: tag.id,
      label: tag.name,
      description:
        tag.usageCount === undefined ? undefined : t("picker.usage", { count: tag.usageCount }),
    };
  }

  function toChip(option: AsyncComboboxOption): TagChipDTO {
    return (
      known.current.get(option.value) ??
      value.find((tag) => tag.id === option.value) ?? {
        id: option.value,
        name: option.label,
        color: PRESET_TAG_COLORS[7],
      }
    );
  }

  async function loadOptions(query: string) {
    const result = await listTagsAction({ q: query || undefined, pageSize: PICKER_PAGE_SIZE });
    if (!result.ok) {
      toast.error(tErrors(result.error.code));
      return [];
    }
    return result.data.items.map((tag) => {
      remember(tag);
      return toOption(tag);
    });
  }

  async function createOption(name: string) {
    const result = await createTagAction({ name, color: INLINE_TAG_COLOR });
    if (!result.ok) {
      toast.error(tErrors(result.error.code));
      return null;
    }
    remember(result.data);
    return toOption(result.data);
  }

  return (
    <div className="flex flex-col gap-2">
      <AsyncCombobox
        multiple
        value={value.map((tag) => ({ value: tag.id, label: tag.name }))}
        onChange={(options) => onChange(options.map(toChip))}
        loadOptions={loadOptions}
        onCreate={canCreate ? createOption : undefined}
        placeholder={t("picker.placeholder")}
        {...props}
      />
      <TagChips tags={value} />
    </div>
  );
}
