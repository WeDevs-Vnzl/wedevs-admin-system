import { NotFoundError, ValidationFailedError } from '../../../shared/domain/domain-error';
import type { FieldErrors } from '../../../shared/domain/domain-error';
import { PROJECT_LINK_GROUP_VALUES, type ProjectLinkGroup } from '../../../shared/domain/enums';

/**
 * Project links (PRD §8.3, HU-07): URLs grouped by an enum, ordered inside their group. Ported from the
 * links part of `fe/src/mocks/services/projects.ts`. A link has no soft delete. Pure: ids are passed in.
 */

export const PROJECT_LINK_LIMITS = { label: 80, url: 2048, perProject: 100 } as const;

const KEYS = {
  required: 'validation.required',
  tooLong: 'validation.tooLong',
  invalidFormat: 'validation.invalidFormat',
  invalidOption: 'validation.invalidOption',
} as const;

export interface ProjectLinkRecord {
  readonly id: string;
  readonly group: ProjectLinkGroup;
  readonly label: string;
  readonly url: string;
  readonly order: number;
}

/** A link as a caller sends it; `id` is present when editing an existing one. */
export interface ProjectLinkInput {
  readonly id?: string | undefined;
  readonly group: ProjectLinkGroup;
  readonly label: string;
  readonly url: string;
  readonly order: number;
}

/** `http:` / `https:` URL with a host. Rejects `javascript:`, `data:`, `file:` and friends (C4). */
export function isHttpUrl(value: string): boolean {
  if (value.length > PROJECT_LINK_LIMITS.url) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '';
  } catch {
    return false;
  }
}

/**
 * Trims the label and URL and checks them. Every failure of the batch is reported at once on
 * `links.<index>.label` / `links.<index>.url` (HU-07 CA3).
 */
export function normalizeLinkInputs(inputs: readonly ProjectLinkInput[]): ProjectLinkInput[] {
  const fieldErrors: FieldErrors = {};
  const fail = (index: number, field: 'label' | 'url', key: string): void => {
    (fieldErrors[`links.${index}.${field}`] ??= []).push(key);
  };
  const normalized = inputs.map((input, index) => {
    const label = input.label.trim();
    const url = input.url.trim();
    if (label.length === 0) fail(index, 'label', KEYS.required);
    else if (label.length > PROJECT_LINK_LIMITS.label) fail(index, 'label', KEYS.tooLong);
    if (!isHttpUrl(url)) fail(index, 'url', KEYS.invalidFormat);
    return { ...input, label, url };
  });
  if (Object.keys(fieldErrors).length > 0) throw new ValidationFailedError({ fieldErrors });
  return normalized;
}

const groupRank = (group: ProjectLinkGroup): number => PROJECT_LINK_GROUP_VALUES.indexOf(group);

/** Links in group order (enum order), then by `order` inside the group. */
export function sortLinks(links: readonly ProjectLinkRecord[]): ProjectLinkRecord[] {
  return links
    .map((link) => ({ ...link }))
    .sort((a, b) => groupRank(a.group) - groupRank(b.group) || a.order - b.order);
}

/** Re-numbers the links of every group to `0..n-1`, keeping the current relative order. */
export function renumberLinks(links: readonly ProjectLinkRecord[]): ProjectLinkRecord[] {
  const next: ProjectLinkRecord[] = [];
  for (const group of PROJECT_LINK_GROUP_VALUES) {
    sortLinks(links.filter((link) => link.group === group)).forEach((link, order) => {
      next.push({ ...link, order });
    });
  }
  return next;
}

/** The links of a new project: sorted by their requested order (ties by position), then re-numbered. */
export function initialLinks(
  inputs: readonly ProjectLinkInput[],
  newId: () => string,
): ProjectLinkRecord[] {
  return renumberLinks(
    inputs
      .map((link, position) => ({ link, position }))
      .sort((a, b) => a.link.order - b.link.order || a.position - b.position)
      .map(({ link }) => ({
        id: newId(),
        group: link.group,
        label: link.label,
        url: link.url,
        order: link.order,
      })),
  );
}

/**
 * Creates the links without id and updates the ones with id; removes none. A new link goes to the end of
 * its group; an updated one moves to its `order` (a different group puts it last there). Every group is
 * then re-numbered `0..n-1`. An unknown id is a bare `NOT_FOUND` that does not echo it.
 */
export function upsertLinks(
  current: readonly ProjectLinkRecord[],
  inputs: readonly ProjectLinkInput[],
  newId: () => string,
): ProjectLinkRecord[] {
  const links = current.map((link) => ({ ...link }));
  const lastOrder = (group: ProjectLinkGroup): number =>
    links
      .filter((link) => link.group === group)
      .reduce((max, link) => Math.max(max, link.order), -1);

  for (const entry of inputs) {
    if (entry.id === undefined) {
      links.push({
        id: newId(),
        group: entry.group,
        label: entry.label,
        url: entry.url,
        order: lastOrder(entry.group) + 1,
      });
      continue;
    }
    const existing = links.find((link) => link.id === entry.id);
    if (!existing) throw new NotFoundError();
    const moved = existing.group !== entry.group;
    existing.label = entry.label;
    existing.url = entry.url;
    existing.order = moved ? lastOrder(entry.group) + 1 : entry.order;
    existing.group = entry.group;
  }
  return renumberLinks(links);
}

/** Reorders one group: `orderedIds` must be exactly the ids of the group. */
export function reorderLinks(
  current: readonly ProjectLinkRecord[],
  group: ProjectLinkGroup,
  orderedIds: readonly string[],
): ProjectLinkRecord[] {
  const inGroup = current.filter((link) => link.group === group).map((link) => link.id);
  const sameSet =
    inGroup.length === orderedIds.length && orderedIds.every((id) => inGroup.includes(id));
  if (!sameSet) {
    throw new ValidationFailedError({ fieldErrors: { orderedLinkIds: [KEYS.invalidOption] } });
  }
  return current.map((link) =>
    link.group === group ? { ...link, order: orderedIds.indexOf(link.id) } : { ...link },
  );
}

/** Removes one link and closes the gap in its group. An unknown id is a bare `NOT_FOUND`. */
export function removeLink(
  current: readonly ProjectLinkRecord[],
  linkId: string,
): { readonly links: ProjectLinkRecord[]; readonly removed: ProjectLinkRecord } {
  const removed = current.find((link) => link.id === linkId);
  if (!removed) throw new NotFoundError();
  return { links: renumberLinks(current.filter((link) => link.id !== linkId)), removed };
}
