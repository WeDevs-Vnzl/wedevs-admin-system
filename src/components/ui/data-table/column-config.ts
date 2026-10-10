import type { ColumnConfig } from "./types";

/** Narrowest width a user can give a column (px). */
export const MIN_COLUMN_WIDTH = 80;
export const DEFAULT_COLUMN_WIDTH = 150;

export interface ColumnDescriptor {
  id: string;
  hideable: boolean;
}

/** Default config: every column visible, in definition order, no width override. */
export function defaultColumnConfig(descriptors: ColumnDescriptor[]): ColumnConfig[] {
  return descriptors.map(({ id }) => ({ id, visible: true }));
}

/**
 * Merges a saved config with the current column definitions: saved order wins for known ids, unknown
 * ids are dropped, new columns are appended visible, and non-hideable columns are always visible.
 */
export function resolveColumnConfig(
  descriptors: ColumnDescriptor[],
  saved: ColumnConfig[] = [],
): ColumnConfig[] {
  const known = new Map(descriptors.map((d) => [d.id, d] as const));
  const seen = new Set<string>();
  const out: ColumnConfig[] = [];

  for (const entry of saved) {
    const descriptor = known.get(entry.id);
    if (!descriptor || seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(normalize(entry, descriptor));
  }
  for (const descriptor of descriptors) {
    if (seen.has(descriptor.id)) continue;
    out.push({ id: descriptor.id, visible: true });
  }
  return out;
}

function normalize(entry: ColumnConfig, descriptor: ColumnDescriptor): ColumnConfig {
  const visible = descriptor.hideable ? entry.visible : true;
  return entry.width === undefined
    ? { id: entry.id, visible }
    : { id: entry.id, visible, width: clampWidth(entry.width) };
}

export function setColumnVisible(
  config: ColumnConfig[],
  id: string,
  visible: boolean,
): ColumnConfig[] {
  return config.map((column) => (column.id === id ? { ...column, visible } : column));
}

/** Moves a column one position up (`-1`) or down (`+1`); no-op at the edges. */
export function moveColumn(config: ColumnConfig[], id: string, direction: -1 | 1): ColumnConfig[] {
  const index = config.findIndex((column) => column.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= config.length) return config;
  const next = [...config];
  const [moved] = next.splice(index, 1);
  if (moved) next.splice(target, 0, moved);
  return next;
}

export function setColumnWidth(config: ColumnConfig[], id: string, width: number): ColumnConfig[] {
  return config.map((column) =>
    column.id === id ? { ...column, width: clampWidth(width) } : column,
  );
}

export function visibleColumnIds(config: ColumnConfig[]): string[] {
  return config.filter((column) => column.visible).map((column) => column.id);
}

export function clampWidth(width: number): number {
  return Math.max(MIN_COLUMN_WIDTH, Math.round(width));
}
