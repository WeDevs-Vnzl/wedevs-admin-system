import { describe, expect, it } from 'vitest';
import {
  TAGGABLE_ENTITY_TYPE_VALUES,
  assertTagColor,
  compareTagsForChips,
  isTaggableEntityType,
  normalizeTagName,
  sameTagName,
  tagChanges,
  targetKey,
  toTagChip,
} from './tag';

describe('normalizeTagName', () => {
  it('trims the name', () => {
    expect(normalizeTagName('  Nuevo  ')).toBe('Nuevo');
  });

  it('rejects an empty or blank name with validation.required on name', () => {
    for (const raw of ['', '   ']) {
      expect(() => normalizeTagName(raw)).toThrowError(
        expect.objectContaining({
          code: 'VALIDATION',
          fieldErrors: { name: ['validation.required'] },
        }),
      );
    }
  });

  it('accepts 40 characters and rejects 41 (counted after trimming)', () => {
    expect(normalizeTagName(` ${'a'.repeat(40)} `)).toHaveLength(40);
    expect(() => normalizeTagName('a'.repeat(41))).toThrowError(
      expect.objectContaining({ fieldErrors: { name: ['validation.tooLong'] } }),
    );
  });
});

describe('assertTagColor', () => {
  it('accepts #RRGGBB in either case', () => {
    expect(assertTagColor('#1A2b3C')).toBe('#1A2b3C');
  });

  it.each(['1A2B3C', '#123', '#GGGGGG', 'red', '#1234567', ''])('rejects %s', (bad) => {
    expect(() => assertTagColor(bad)).toThrowError(
      expect.objectContaining({
        code: 'VALIDATION',
        fieldErrors: { color: ['validation.invalidFormat'] },
      }),
    );
  });
});

describe('sameTagName', () => {
  it('ignores case and surrounding spaces', () => {
    expect(sameTagName('Cliente clave', '  CLIENTE CLAVE ')).toBe(true);
    expect(sameTagName('a', 'b')).toBe(false);
  });
});

describe('taggable entity types', () => {
  it('lists the eight taggable entities of PRD §7.5', () => {
    expect(TAGGABLE_ENTITY_TYPE_VALUES).toEqual([
      'CLIENT',
      'CONTACT',
      'PROJECT',
      'INVOICE',
      'PAYMENT',
      'EXPENSE',
      'DOCUMENT',
      'NOTE',
    ]);
    expect(isTaggableEntityType('NOTE')).toBe(true);
    expect(isTaggableEntityType('TAG')).toBe(false);
    expect(targetKey({ entityType: 'CLIENT', entityId: 'c1' })).toBe('CLIENT:c1');
  });
});

describe('tagChanges', () => {
  it('records only the changed fields, or null when nothing changed', () => {
    expect(tagChanges({ name: 'A', color: '#000000' }, { name: 'B', color: '#000000' })).toEqual({
      name: ['A', 'B'],
    });
    expect(tagChanges({ name: 'A', color: '#000000' }, { name: 'A', color: '#000000' })).toBeNull();
  });
});

describe('chips', () => {
  it('orders by creation then id and drops everything but id, name and colour', () => {
    const a = { id: 'b', name: 'A', color: '#000000', createdAt: new Date(1) };
    const b = { id: 'a', name: 'B', color: '#000000', createdAt: new Date(1) };
    const c = { id: 'c', name: 'C', color: '#000000', createdAt: new Date(0) };
    expect([a, b, c].sort(compareTagsForChips).map((t) => t.id)).toEqual(['c', 'a', 'b']);
    expect(toTagChip(a)).toEqual({ id: 'b', name: 'A', color: '#000000' });
  });
});
