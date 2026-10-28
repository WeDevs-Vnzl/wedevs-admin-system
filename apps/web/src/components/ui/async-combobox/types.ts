export interface AsyncComboboxOption {
  /** Stable id of the record (what the form stores). */
  value: string;
  label: string;
  /** Secondary line shown under the label (e.g. the entity code). */
  description?: string;
  /** Options with the same `group` are listed under one heading, in order of appearance. */
  group?: string;
  disabled?: boolean;
  /** Per-item free text edited through `secondaryInput` (e.g. a technology version). */
  secondary?: string;
}

export interface AsyncComboboxSecondaryInput {
  /** Already localized label of the per-item input. */
  label: string;
  placeholder?: string;
  maxLength?: number;
}

interface AsyncComboboxBaseProps {
  /** Reads options through a read action; called with `""` when the popup opens. */
  loadOptions: (query: string) => Promise<readonly AsyncComboboxOption[]>;
  /** Shows "Crear «q»" for a query without an exact match; resolves to the new option. */
  onCreate?: (query: string) => Promise<AsyncComboboxOption | null | undefined | void>;
  debounceMs?: number;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  /** Edits `option.secondary` of each selected item in a row under the field. */
  secondaryInput?: AsyncComboboxSecondaryInput;
  className?: string;
}

export interface AsyncComboboxSingleProps extends AsyncComboboxBaseProps {
  multiple?: false;
  value: AsyncComboboxOption | null;
  onChange: (value: AsyncComboboxOption | null) => void;
}

export interface AsyncComboboxMultiProps extends AsyncComboboxBaseProps {
  multiple: true;
  value: readonly AsyncComboboxOption[];
  onChange: (value: AsyncComboboxOption[]) => void;
}

export type AsyncComboboxProps = AsyncComboboxSingleProps | AsyncComboboxMultiProps;
