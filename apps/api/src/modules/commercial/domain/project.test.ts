import { describe, expect, it } from 'vitest';
import { ValidationFailedError } from '../../../shared/domain/domain-error';
import type { RichTextDoc } from '../../../shared/domain/rich-text';
import {
  assertStatusDates,
  diffClientLinks,
  earliestClientId,
  normalizeProjectClients,
  normalizeProjectFields,
  projectChanges,
  projectDiffView,
  projectSearchDocument,
  sortedNames,
} from './project';

const fieldErrorsOf = (run: () => unknown): Record<string, string[]> | undefined => {
  try {
    run();
  } catch (error) {
    return (error as ValidationFailedError).fieldErrors;
  }
  return undefined;
};

const base = { name: 'Sitio', summary: 'Resumen' };
const doc = (content: unknown[]): RichTextDoc => ({ type: 'doc', content }) as RichTextDoc;
const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

describe('normalizeProjectFields', () => {
  it('trims name and summary and derives the plain description text', () => {
    const fields = normalizeProjectFields({
      name: '  Sitio  ',
      summary: ' Resumen ',
      description: doc([paragraph('Hola'), paragraph('mundo')]),
    });
    expect(fields).toMatchObject({
      name: 'Sitio',
      summary: 'Resumen',
      descriptionText: 'Hola mundo',
    });
    expect(normalizeProjectFields(base)).toMatchObject({
      description: null,
      descriptionText: null,
    });
  });

  it('requires name and summary and limits the summary to 280 characters (HU-05)', () => {
    expect(fieldErrorsOf(() => normalizeProjectFields({ name: ' ', summary: '' }))).toEqual({
      name: ['validation.required'],
      summary: ['validation.required'],
    });
    expect(normalizeProjectFields({ ...base, summary: 'x'.repeat(280) }).summary).toHaveLength(280);
    expect(
      fieldErrorsOf(() => normalizeProjectFields({ ...base, summary: 'x'.repeat(281) })),
    ).toEqual({
      summary: ['validation.tooLong'],
    });
    expect(fieldErrorsOf(() => normalizeProjectFields({ ...base, name: 'x'.repeat(121) }))).toEqual(
      {
        name: ['validation.tooLong'],
      },
    );
  });

  it('rejects image nodes in the description: a project has no attachments (contract choice 6)', () => {
    const withImage = doc([{ type: 'image', attrs: { fileId: 'fil_1' } }]);
    expect(
      fieldErrorsOf(() => normalizeProjectFields({ ...base, description: withImage })),
    ).toEqual({
      description: ['validation.invalidFormat'],
    });
  });

  it('sanitizes the description itself: no caller can skip it (B2)', () => {
    const unsafe = (attrs: unknown) =>
      ({
        type: 'doc',
        content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs }] }],
      }) as unknown as RichTextDoc;
    expect(
      fieldErrorsOf(() =>
        normalizeProjectFields({ ...base, description: unsafe({ href: 'javascript:alert(1)' }) }),
      ),
    ).toEqual({ description: ['validation.invalidFormat'] });
    expect(
      fieldErrorsOf(() =>
        normalizeProjectFields({ ...base, description: doc([{ type: 'script' }]) }),
      ),
    ).toEqual({ description: ['validation.invalidFormat'] });
    expect(
      fieldErrorsOf(() =>
        normalizeProjectFields({ ...base, description: doc([paragraph('x'.repeat(500_000))]) }),
      ),
    ).toEqual({ description: ['validation.tooLong'] });
  });

  it('stores the clean copy of the description, not the raw input', () => {
    const fields = normalizeProjectFields({
      ...base,
      description: doc([paragraph('hola')]),
    });
    expect(fields.description).toEqual(doc([paragraph('hola')]));
    expect(fields.descriptionText).toBe('hola');
  });

  it('refuses a target or actual end before the start', () => {
    expect(
      fieldErrorsOf(() =>
        normalizeProjectFields({
          ...base,
          startDate: '2026-05-10',
          targetEndDate: '2026-05-01',
          endDate: '2026-05-09',
        }),
      ),
    ).toEqual({
      targetEndDate: ['validation.date.invalid'],
      endDate: ['validation.date.invalid'],
    });
    expect(
      normalizeProjectFields({ ...base, startDate: '2026-05-10', endDate: '2026-05-10' }).endDate,
    ).toBe('2026-05-10');
  });
});

describe('assertStatusDates (HU-08 CA1, CA2)', () => {
  it('needs a start date for EN_CURSO and an end date for ENTREGADO', () => {
    expect(
      fieldErrorsOf(() => assertStatusDates('EN_CURSO', { startDate: null, endDate: null })),
    ).toEqual({
      startDate: ['validation.required'],
    });
    expect(
      fieldErrorsOf(() =>
        assertStatusDates('ENTREGADO', { startDate: '2026-01-01', endDate: null }),
      ),
    ).toEqual({ endDate: ['validation.required'] });
    expect(() => assertStatusDates('PROPUESTA', { startDate: null, endDate: null })).not.toThrow();
    expect(() =>
      assertStatusDates('EN_CURSO', { startDate: '2026-01-01', endDate: null }),
    ).not.toThrow();
  });
});

describe('normalizeProjectClients (HU-05 CA1, CA2)', () => {
  const now = new Date('2026-03-10T15:00:00Z');

  it('requires at least one client and refuses a repeated one', () => {
    expect(fieldErrorsOf(() => normalizeProjectClients([], now))).toEqual({
      clients: ['validation.required'],
    });
    expect(
      fieldErrorsOf(() => normalizeProjectClients([{ clientId: 'a' }, { clientId: 'a' }], now)),
    ).toEqual({ clients: ['validation.invalidOption'] });
  });

  it('trims the optional role (empty = none) and bounds it to 80', () => {
    const links = normalizeProjectClients(
      [{ clientId: 'a', role: ' Contratante ' }, { clientId: 'b', role: '  ' }, { clientId: 'c' }],
      now,
    );
    expect(links.map((l) => l.role)).toEqual(['Contratante', null, null]);
    expect(
      fieldErrorsOf(() => normalizeProjectClients([{ clientId: 'a', role: 'x'.repeat(81) }], now)),
    ).toEqual({ 'clients.0.role': ['validation.tooLong'] });
  });

  it('stamps new links in input order and keeps the instant of the ones already linked', () => {
    const earlier = new Date('2026-01-01T00:00:00Z');
    const links = normalizeProjectClients([{ clientId: 'b' }, { clientId: 'a' }], now, [
      { clientId: 'a', role: null, linkedAt: earlier },
    ]);
    expect(links.find((l) => l.clientId === 'a')?.linkedAt).toEqual(earlier);
    expect(earliestClientId(links)).toBe('a');
    expect(
      earliestClientId(normalizeProjectClients([{ clientId: 'b' }, { clientId: 'a' }], now)),
    ).toBe('b');
    expect(earliestClientId([])).toBeNull();
  });
});

describe('diffClientLinks (the mock logClientLinks)', () => {
  const at = new Date();
  const link = (clientId: string, role: string | null) => ({ clientId, role, linkedAt: at });

  it('reports LINK, UNLINK and role changes', () => {
    const changes = diffClientLinks(
      [link('a', 'Contratante'), link('b', null)],
      [link('a', 'Usuario final'), link('c', 'Nuevo')],
    );
    expect(changes).toEqual([
      { kind: 'ROLE', clientId: 'a', role: 'Usuario final', previousRole: 'Contratante' },
      { kind: 'LINK', clientId: 'c', role: 'Nuevo', previousRole: null },
      { kind: 'UNLINK', clientId: 'b', role: null, previousRole: null },
    ]);
    expect(diffClientLinks([link('a', null)], [link('a', null)])).toEqual([]);
  });
});

describe('project diff (HU-29 CA1, C1, C20)', () => {
  it('sorts names and joins them with ", ", never ids', () => {
    expect(sortedNames(['Rust', 'next', 'Árbol'])).toBe('Árbol, next, Rust');
  });

  it('records the description as "changed" and stack/tags as sorted names', () => {
    const before = projectDiffView(
      { ...base, description: null, startDate: null, targetEndDate: null, endDate: null },
      ['Rust'],
      ['b', 'a'],
    );
    const after = projectDiffView(
      {
        ...base,
        name: 'Sitio 2',
        description: doc([paragraph('x')]),
        startDate: null,
        targetEndDate: null,
        endDate: null,
      },
      ['Rust', 'Next.js'],
      ['a', 'b'],
    );
    expect(projectChanges(before, after)).toEqual({
      name: ['Sitio', 'Sitio 2'],
      description: 'changed',
      technologyIds: ['Rust', 'Next.js, Rust'],
    });
    expect(projectChanges(before, before)).toBeNull();
  });
});

describe('projectSearchDocument (HU-23 CA1)', () => {
  it('indexes code, name, client names, summary and description text', () => {
    expect(
      projectSearchDocument(
        {
          code: 'PRY-0001',
          name: 'Sitio',
          summary: 'Resumen',
          descriptionText: 'Texto',
          status: 'EN_CURSO',
        },
        ['Kairós', 'Tornillo'],
      ),
    ).toEqual({
      code: 'PRY-0001',
      title: 'Sitio',
      subtitle: 'Kairós, Tornillo',
      body: 'Resumen\nTexto',
      status: 'EN_CURSO',
    });
  });
});
