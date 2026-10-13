"use client";

import { XIcon } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AsyncCombobox, type AsyncComboboxOption } from "@/components/ui/async-combobox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { searchClientsAction } from "@/features/clients/actions";
import { searchContactsAction } from "@/features/contacts/actions";
import { searchDocumentsAction } from "@/features/documents/actions";
import { searchProjectsAction } from "@/features/projects/actions";
import type { ActionResult, EntityRef } from "@/lib/validators/common";
import type { EntityType } from "@/lib/validators/enums";
import type { NoteLinkEntityType } from "@/lib/validators/notes";

/** A record a note hangs from (client, contact, project, document…), with the label the chip shows. */
export type NoteLinkRef = Pick<EntityRef, "id" | "label"> & { type: NoteLinkEntityType };

/** Record types the picker offers in H1-B2; H1-B3 adds INVOICE, PAYMENT and EXPENSE. */
const PICKER_TYPES = ["CLIENT", "CONTACT", "PROJECT", "DOCUMENT"] as const;
type PickerType = (typeof PICKER_TYPES)[number];

const LINK_TYPES: readonly string[] = [
  "CLIENT",
  "CONTACT",
  "PROJECT",
  "DOCUMENT",
  "INVOICE",
  "PAYMENT",
  "EXPENSE",
];

/** A link of a note as the note DTO gives it, when its type can be linked from the UI. */
export function toNoteLinkRef(ref: EntityRef): NoteLinkRef | null {
  return LINK_TYPES.includes(ref.type)
    ? { id: ref.id, label: ref.label, type: ref.type as NoteLinkEntityType }
    : null;
}

type SearchAction = (input: { q: string }) => Promise<ActionResult<EntityRef[]>>;

/** The W2 typeahead of each record type (at most 20 `EntityRef`s, archived records excluded). */
const SEARCH: Record<PickerType, SearchAction> = {
  CLIENT: (input) => searchClientsAction(input),
  CONTACT: (input) => searchContactsAction(input),
  PROJECT: (input) => searchProjectsAction(input),
  DOCUMENT: (input) => searchDocumentsAction(input),
};

export interface NoteLinkPickerProps {
  /** Links already on the note (or the prefilled ones of a new note). */
  value: readonly NoteLinkRef[];
  onAdd: (link: NoteLinkRef) => void;
  onRemove: (link: NoteLinkRef) => void;
  disabled?: boolean;
  id?: string;
}

/**
 * Link editor of a note: a record type, a `AsyncCombobox` over that type's search action, and the chips of
 * the current links with their remove buttons. The picker only reports adds and removes; the caller decides
 * whether they go into a form or through `linkNoteAction` / `unlinkNoteAction`.
 */
export function NoteLinkPicker({ value, onAdd, onRemove, disabled = false, id }: NoteLinkPickerProps) {
  const t = useTranslations("notes.linkPicker");
  const tEntity = useTranslations("enums.EntityType");
  const tErrors = useTranslations("common.errors");
  const [type, setType] = useState<PickerType>("CLIENT");

  async function loadOptions(q: string): Promise<AsyncComboboxOption[]> {
    const result = await SEARCH[type]({ q });
    if (!result.ok) {
      toast.error(tErrors(result.error.code));
      return [];
    }
    return result.data.map((ref) => ({ value: ref.id, label: ref.label, description: ref.code }));
  }

  function pick(option: AsyncComboboxOption | null) {
    if (!option) return;
    // A record already linked is not added twice; the combobox never keeps the choice (value stays null).
    if (value.some((link) => link.type === type && link.id === option.value)) return;
    onAdd({ type, id: option.value, label: option.label });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <Select
          value={type}
          onValueChange={(next) => setType(next as PickerType)}
          disabled={disabled}
        >
          <SelectTrigger aria-label={t("type")} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PICKER_TYPES.map((entity) => (
              <SelectItem key={entity} value={entity}>
                {tEntity(entity as EntityType)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <AsyncCombobox
          key={type}
          id={id}
          multiple={false}
          value={null}
          onChange={pick}
          loadOptions={loadOptions}
          placeholder={t("search")}
          aria-label={t("record")}
          disabled={disabled}
        />
      </div>

      {value.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {value.map((link) => (
            <li key={`${link.type}:${link.id}`}>
              <Badge variant="secondary" className="gap-1 pe-1">
                {link.label}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("remove", { label: link.label })}
                  disabled={disabled}
                  onClick={() => onRemove(link)}
                >
                  <XIcon aria-hidden />
                </Button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
