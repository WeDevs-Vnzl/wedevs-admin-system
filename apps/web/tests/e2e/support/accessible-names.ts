/** Escapes a string for use inside a RegExp source. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Matches an accessible name that starts with `name`. An `AsyncCombobox` option name also carries its description
 * (for example the client code), so an exact match on the name alone never finds the option (FE-INT-R run #2).
 */
export function namePrefix(name: string): RegExp {
  return new RegExp(`^${escapeRegExp(name)}`);
}

/** Matches an accessible name that is exactly one of `labels` (the Spanish and the English copy of one control). */
export function oneOf(...labels: string[]): RegExp {
  return new RegExp(`^(${labels.map(escapeRegExp).join("|")})$`);
}
