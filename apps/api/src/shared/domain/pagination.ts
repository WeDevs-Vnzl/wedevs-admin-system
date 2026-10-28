export const PAGE_SIZE_VALUES = [25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZE_VALUES)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 25;

export interface PageRequest {
  readonly page: number;
  readonly pageSize: number;
}

/** Response envelope of every list (`api-contract.md` §3). */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

/** Rows to skip and take for a 1-based page. */
export function pageWindow(page: number, pageSize: number): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export function paginated<T>(items: T[], total: number, request: PageRequest): Paginated<T> {
  return {
    items,
    total,
    page: request.page,
    pageSize: request.pageSize,
    pageCount: Math.max(1, Math.ceil(total / request.pageSize)),
  };
}
