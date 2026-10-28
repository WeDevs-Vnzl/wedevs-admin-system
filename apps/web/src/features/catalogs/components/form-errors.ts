import type { FieldValues, Path, UseFormSetError } from "react-hook-form";

/**
 * Puts the field errors of a failed action on the form fields it names (`CONFLICT` on a code, a service
 * `VALIDATION` on a parent…). Errors for fields the form does not show are left to the toast.
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
