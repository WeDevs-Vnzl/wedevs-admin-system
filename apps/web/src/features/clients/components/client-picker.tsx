"use client";

import { AsyncCombobox, type AsyncComboboxOption } from "@/components/ui/async-combobox";
import { searchClientsAction } from "@/features/clients/actions";

/** The client the form stores: its id, and the name it shows (resolved on the server or picked here). */
export type ClientPickerValue = { id: string; name: string };

export interface ClientPickerProps {
  /** Id of the input, so a `<label htmlFor>` names it (the E2E anchor too). */
  id: string;
  value: ClientPickerValue | null;
  onChange: (value: ClientPickerValue | null) => void;
  disabled?: boolean;
  placeholder?: string;
  "aria-invalid"?: boolean;
}

/**
 * Searchable client field of the invoice and payment forms. The options come from the BE typeahead
 * (`GET /api/v1/clients/search`, up to 20 live clients matching the typed text), never from a preloaded list, so
 * every client is pickable whatever the size of the list. A failed search answers no options.
 */
export function ClientPicker({
  id,
  value,
  onChange,
  disabled,
  placeholder,
  ...rest
}: ClientPickerProps) {
  async function loadOptions(query: string): Promise<AsyncComboboxOption[]> {
    const result = await searchClientsAction({ q: query });
    if (!result.ok) return [];
    return result.data.map((ref) => ({ value: ref.id, label: ref.label, description: ref.code }));
  }

  return (
    <AsyncCombobox
      id={id}
      value={value ? { value: value.id, label: value.name } : null}
      onChange={(option) => onChange(option ? { id: option.value, name: option.label } : null)}
      loadOptions={loadOptions}
      disabled={disabled}
      placeholder={placeholder}
      aria-invalid={rest["aria-invalid"]}
    />
  );
}
