import { arrayMove } from "@dnd-kit/sortable";
import { PROJECT_LINK_GROUP_VALUES, type ProjectLinkGroup } from "@/lib/validators/enums";
import type { ProjectLinkDTO } from "@/lib/validators/projects";

/**
 * One link as the editor holds it. `key` is stable for React and drag and sort (the id of a saved link, a
 * local key for a new one); `id` is present only for links the service already stores.
 */
export interface ProjectLinkRow {
  key: string;
  id?: string;
  group: ProjectLinkGroup;
  label: string;
  url: string;
  order: number;
}

export const LINK_GROUPS: readonly ProjectLinkGroup[] = PROJECT_LINK_GROUP_VALUES;

/** Rows of a saved project, in group order then link order. */
export function linkRowsFromDto(links: readonly ProjectLinkDTO[]): ProjectLinkRow[] {
  return links.map((link) => ({
    key: link.id,
    id: link.id,
    group: link.group,
    label: link.label,
    url: link.url,
    order: link.order,
  }));
}

/** The rows of one group, in their order. */
export function groupRows(
  rows: readonly ProjectLinkRow[],
  group: ProjectLinkGroup,
): ProjectLinkRow[] {
  return rows.filter((row) => row.group === group).sort((a, b) => a.order - b.order);
}

/** Gives the rows of each group consecutive `order` values (0, 1, 2…), keeping the given sequence. */
function renumber(rows: readonly ProjectLinkRow[]): ProjectLinkRow[] {
  const next = new Map<ProjectLinkGroup, number>();
  return rows.map((row) => {
    const order = next.get(row.group) ?? 0;
    next.set(row.group, order + 1);
    return { ...row, order };
  });
}

/** Keeps the rows as they are, with a group's rows replaced by `ordered` (in that sequence). */
function replaceGroup(
  rows: readonly ProjectLinkRow[],
  group: ProjectLinkGroup,
  ordered: readonly ProjectLinkRow[],
): ProjectLinkRow[] {
  const others = rows.filter((row) => row.group !== group);
  return renumber([...others, ...ordered]).sort((a, b) => {
    const groupDelta = LINK_GROUPS.indexOf(a.group) - LINK_GROUPS.indexOf(b.group);
    return groupDelta !== 0 ? groupDelta : a.order - b.order;
  });
}

/** Moves the link one place up (`-1`) or down (`+1`) inside its group; a no-op at the group's edges. */
export function moveLink(
  rows: readonly ProjectLinkRow[],
  key: string,
  delta: -1 | 1,
): ProjectLinkRow[] {
  const row = rows.find((item) => item.key === key);
  if (!row) return [...rows];
  const ordered = groupRows(rows, row.group);
  const from = ordered.findIndex((item) => item.key === key);
  const to = from + delta;
  if (to < 0 || to >= ordered.length) return [...rows];
  return replaceGroup(rows, row.group, arrayMove(ordered, from, to));
}

/** Moves the link `activeKey` to the position of `overKey`, inside their shared group (drag and drop). */
export function reorderWithinGroup(
  rows: readonly ProjectLinkRow[],
  activeKey: string,
  overKey: string,
): ProjectLinkRow[] {
  const active = rows.find((item) => item.key === activeKey);
  const over = rows.find((item) => item.key === overKey);
  if (!active || !over || active.group !== over.group || active.key === over.key) return [...rows];
  const ordered = groupRows(rows, active.group);
  const from = ordered.findIndex((item) => item.key === activeKey);
  const to = ordered.findIndex((item) => item.key === overKey);
  return replaceGroup(rows, active.group, arrayMove(ordered, from, to));
}

/** Removes one link and renumbers its group. */
export function removeLink(rows: readonly ProjectLinkRow[], key: string): ProjectLinkRow[] {
  return renumber(rows.filter((row) => row.key !== key));
}

/** Appends a new empty link to a group (the service appends new links at the end of their group too). */
export function addLink(
  rows: readonly ProjectLinkRow[],
  group: ProjectLinkGroup,
  key: string,
): ProjectLinkRow[] {
  const order = groupRows(rows, group).length;
  return [...rows, { key, group, label: "", url: "", order }];
}

/** Ids of one group in their current order: the payload of `reorderProjectLinksAction`. */
export function orderedIdsOf(rows: readonly ProjectLinkRow[], group: ProjectLinkGroup): string[] {
  return groupRows(rows, group).flatMap((row) => (row.id ? [row.id] : []));
}

/**
 * Favicon of a link's host, straight from the site (`https://<host>/favicon.ico`): no third-party favicon
 * service (HU-07). `null` when the URL does not parse.
 */
export function faviconUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return `https://${parsed.host}/favicon.ico`;
  } catch {
    return null;
  }
}
