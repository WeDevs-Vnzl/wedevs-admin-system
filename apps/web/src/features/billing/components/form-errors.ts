import type { FieldValues, Path, UseFormSetError } from "react-hook-form";

/**
 * Puts the field errors of a failed action on the fields the form shows (a service `VALIDATION` names the field).
 * Errors for fields the form does not show are left to the toast.
 */
export function applyFieldErrors<T extends FieldValues>(
  setError: UseFormSetError<T>,
  fieldErrors: Record<string, string[]> | undefined,
  fields: readonly Path<T>[],
): void {
  if (!fieldErrors) return;
  for (const [field, messages] of Object.entries(fieldErrors)) {
    const message = messages[0];
    if (message && (fields as readonly string[]).includes(field)) {
      setError(field as Path<T>, { message });
    }
  }
}

/** Empty text inputs are sent as absent optional fields (`""` is not a date, a percentage or a trigger). */
export function orUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}
