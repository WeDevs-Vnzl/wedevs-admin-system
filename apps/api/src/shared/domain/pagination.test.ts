import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_VALUES, pageWindow, paginated } from './pagination';

describe('page sizes', () => {
  it('are 25, 50 and 100 with 25 as default', () => {
    expect([...PAGE_SIZE_VALUES]).toEqual([25, 50, 100]);
    expect(DEFAULT_PAGE_SIZE).toBe(25);
  });
});

describe('pageWindow', () => {
  it('computes skip and take', () => {
    expect(pageWindow(1, 25)).toEqual({ skip: 0, take: 25 });
    expect(pageWindow(3, 25)).toEqual({ skip: 50, take: 25 });
    expect(pageWindow(2, 100)).toEqual({ skip: 100, take: 100 });
  });
});

describe('paginated', () => {
  it('computes pageCount (at least 1)', () => {
    expect(paginated(['a'], 51, { page: 1, pageSize: 25 })).toEqual({
      items: ['a'],
      total: 51,
      page: 1,
      pageSize: 25,
      pageCount: 3,
    });
    expect(paginated([], 0, { page: 1, pageSize: 25 }).pageCount).toBe(1);
    expect(paginated([], 50, { page: 1, pageSize: 25 }).pageCount).toBe(2);
  });

  it('reports the last partial page', () => {
    const page3 = paginated(new Array(10).fill(0), 60, { page: 3, pageSize: 25 });
    expect(page3).toMatchObject({ total: 60, page: 3, pageSize: 25, pageCount: 3 });
    expect(page3.items).toHaveLength(10);
  });

  it('returns an empty page beyond the last one', () => {
    expect(paginated([], 4, { page: 2, pageSize: 25 })).toMatchObject({ items: [], pageCount: 1 });
  });
});
