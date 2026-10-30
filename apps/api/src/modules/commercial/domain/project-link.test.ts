import { describe, expect, it } from 'vitest';
import { NotFoundError, ValidationFailedError } from '../../../shared/domain/domain-error';
import {
  initialLinks,
  isHttpUrl,
  normalizeLinkInputs,
  removeLink,
  reorderLinks,
  sortLinks,
  upsertLinks,
  type ProjectLinkInput,
  type ProjectLinkRecord,
} from './project-link';

const counter = () => {
  let n = 0;
  return () => `lnk_${++n}`;
};
const link = (
  id: string,
  group: ProjectLinkRecord['group'],
  order: number,
  label = id,
): ProjectLinkRecord => ({ id, group, label, url: `https://example.test/${id}`, order });
const input = (over: Partial<ProjectLinkInput> = {}): ProjectLinkInput => ({
  group: 'REPOSITORIO',
  label: 'Repo',
  url: 'https://example.test',
  order: 0,
  ...over,
});

describe('isHttpUrl (C4)', () => {
  it('accepts http and https URLs with a host', () => {
    expect(isHttpUrl('https://github.com/wedevs/core')).toBe(true);
    expect(isHttpUrl('http://localhost:3000/x')).toBe(true);
  });

  it('rejects unsafe or malformed URLs', () => {
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,x',
      'file:///etc/passwd',
      'ftp://example.test',
      'example.test',
      '',
      `https://example.test/${'a'.repeat(2100)}`,
    ]) {
      expect(isHttpUrl(bad)).toBe(false);
    }
  });
});

describe('normalizeLinkInputs (HU-07 CA3)', () => {
  it('trims label and URL', () => {
    const [first] = normalizeLinkInputs([input({ label: '  Repo  ', url: ' https://a.test ' })]);
    expect(first).toMatchObject({ label: 'Repo', url: 'https://a.test' });
  });

  it('reports every bad link at once on links.<i>.url and links.<i>.label', () => {
    try {
      normalizeLinkInputs([
        input(),
        input({ url: 'javascript:alert(1)' }),
        input({ label: '   ', url: 'nope' }),
        input({ label: 'x'.repeat(81) }),
      ]);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationFailedError);
      expect((error as ValidationFailedError).fieldErrors).toEqual({
        'links.1.url': ['validation.invalidFormat'],
        'links.2.label': ['validation.required'],
        'links.2.url': ['validation.invalidFormat'],
        'links.3.label': ['validation.tooLong'],
      });
    }
  });
});

describe('initialLinks / renumberLinks', () => {
  it('stores the links grouped, ordered and re-numbered per group (mock createProject)', () => {
    const links = initialLinks(
      [
        input({ group: 'ENTORNO', label: 'Prod', order: 5 }),
        input({ group: 'REPOSITORIO', label: 'B', order: 9 }),
        input({ group: 'REPOSITORIO', label: 'A', order: 2 }),
      ],
      counter(),
    );
    expect(links.map((l) => [l.group, l.label, l.order])).toEqual([
      ['REPOSITORIO', 'A', 0],
      ['REPOSITORIO', 'B', 1],
      ['ENTORNO', 'Prod', 0],
    ]);
  });

  it('keeps the requested position on equal orders', () => {
    const links = initialLinks([input({ label: 'first' }), input({ label: 'second' })], counter());
    expect(links.map((l) => l.label)).toEqual(['first', 'second']);
  });
});

describe('upsertLinks (HU-07 CA1)', () => {
  const current = [
    link('a', 'REPOSITORIO', 0),
    link('b', 'REPOSITORIO', 1),
    link('c', 'ENTORNO', 0),
  ];

  it('appends new links to the end of their group, several per group', () => {
    const next = upsertLinks(
      current,
      [input({ label: 'n1' }), input({ label: 'n2' }), input({ group: 'OTRO', label: 'o' })],
      counter(),
    );
    const repos = next.filter((l) => l.group === 'REPOSITORIO');
    expect(repos.map((l) => [l.label, l.order])).toEqual([
      ['a', 0],
      ['b', 1],
      ['n1', 2],
      ['n2', 3],
    ]);
    expect(next.find((l) => l.group === 'OTRO')).toMatchObject({ label: 'o', order: 0 });
  });

  it('edits an existing link and removes none', () => {
    const next = upsertLinks(
      current,
      [input({ id: 'b', label: 'B2', url: 'https://b2.test', order: 1 })],
      counter(),
    );
    expect(next).toHaveLength(3);
    expect(next.find((l) => l.id === 'b')).toMatchObject({ label: 'B2', url: 'https://b2.test' });
  });

  it('moves a link to another group at the end of that group', () => {
    const next = upsertLinks(
      current,
      [input({ id: 'a', group: 'ENTORNO', label: 'a' })],
      counter(),
    );
    expect(next.filter((l) => l.group === 'ENTORNO').map((l) => [l.id, l.order])).toEqual([
      ['c', 0],
      ['a', 1],
    ]);
    expect(next.filter((l) => l.group === 'REPOSITORIO').map((l) => [l.id, l.order])).toEqual([
      ['b', 0],
    ]);
  });

  it('answers a bare NOT_FOUND for an unknown id that does not echo it', () => {
    try {
      upsertLinks(current, [input({ id: 'lnk_secret' })], counter());
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundError);
      expect((error as NotFoundError).message).toBe('common.errors.NOT_FOUND');
      expect(JSON.stringify(error)).not.toContain('lnk_secret');
    }
  });
});

describe('reorderLinks (HU-07 CA2)', () => {
  const current = [
    link('a', 'REPOSITORIO', 0),
    link('b', 'REPOSITORIO', 1),
    link('c', 'ENTORNO', 0),
  ];

  it('reorders inside one group and leaves the other groups alone', () => {
    const next = reorderLinks(current, 'REPOSITORIO', ['b', 'a']);
    expect(sortLinks(next).map((l) => l.id)).toEqual(['b', 'a', 'c']);
    expect(next.find((l) => l.id === 'c')?.order).toBe(0);
  });

  it('refuses a list that is not exactly the ids of the group', () => {
    for (const ids of [['a'], ['a', 'b', 'c'], ['a', 'x']]) {
      expect(() => reorderLinks(current, 'REPOSITORIO', ids)).toThrow(ValidationFailedError);
    }
  });
});

describe('removeLink', () => {
  it('removes a link and closes the gap in its group', () => {
    const current = [
      link('a', 'REPOSITORIO', 0),
      link('b', 'REPOSITORIO', 1),
      link('c', 'REPOSITORIO', 2),
    ];
    const { links, removed } = removeLink(current, 'b');
    expect(removed.id).toBe('b');
    expect(links.map((l) => [l.id, l.order])).toEqual([
      ['a', 0],
      ['c', 1],
    ]);
  });

  it('answers a bare NOT_FOUND for an unknown link', () => {
    expect(() => removeLink([], 'x')).toThrow(NotFoundError);
  });
});
