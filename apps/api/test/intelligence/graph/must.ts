/** Narrows a value a test just arranged; fails loudly instead of using a non-null assertion. */
export function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected a value');
  return value;
}

/** The element at `index`, which the test knows exists. */
export function at<T>(items: readonly T[], index: number): T {
  return must(items[index]);
}
