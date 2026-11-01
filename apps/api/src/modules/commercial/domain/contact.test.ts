import { describe, expect, it } from 'vitest';
import {
  contactChanges,
  contactSearchEntry,
  normalizeContact,
  sortContacts,
  toContactRef,
  type ContactRecord,
} from './contact';

const failure = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error as { code: string; fieldErrors?: Record<string, string[]> };
  }
  throw new Error('expected a failure');
};

describe('normalizeContact', () => {
  it('trims the name and keeps the optional fields as null (HU-04 CA1)', () => {
    const { values } = normalizeContact({
      fullName: '  Ana Pérez ',
      email: 'ana@kairos.example.com',
    });
    expect(values).toEqual({
      fullName: 'Ana Pérez',
      position: null,
      email: 'ana@kairos.example.com',
      phone: null,
      isPrimary: false,
    });
  });

  it('accepts a phone alone', () => {
    expect(normalizeContact({ fullName: 'Ana', phone: '+584121234567' }).values.phone).toBe(
      '+584121234567',
    );
  });

  it('needs an e-mail or a phone and reports the key on both fields', () => {
    const error = failure(() => normalizeContact({ fullName: 'Ana', email: '', phone: '  ' }));
    expect(error.fieldErrors).toEqual({
      email: ['validation.required'],
      phone: ['validation.required'],
    });
  });

  it('reports a missing name, a bad phone and repeated tags together', () => {
    const error = failure(() =>
      normalizeContact({ fullName: ' ', email: 'a@b.test', phone: '123', tagIds: ['t', 't'] }),
    );
    expect(error.fieldErrors).toEqual({
      fullName: ['validation.required'],
      phone: ['validation.invalidFormat'],
      tagIds: ['validation.invalidOption'],
    });
  });
});

describe('contact helpers', () => {
  const record = (over: Partial<ContactRecord>): ContactRecord => ({
    id: 'c1',
    clientId: 'cli_1',
    fullName: 'Ana',
    position: 'CTO',
    email: 'ana@kairos.example.com',
    phone: '+584121234567',
    isPrimary: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    ...over,
  });

  it('puts the primary contact first and then orders by name', () => {
    const sorted = sortContacts([
      record({ id: 'a', fullName: 'Zoe' }),
      record({ id: 'b', fullName: 'Álvaro' }),
      record({ id: 'c', fullName: 'Marta', isPrimary: true }),
    ]);
    expect(sorted.map((row) => row.id)).toEqual(['c', 'b', 'a']);
  });

  it('diffs the fields and the tag names', () => {
    const before = normalizeContact({ fullName: 'Ana', email: 'ana@kairos.example.com' }).values;
    expect(
      contactChanges(
        before,
        { ...before, position: 'CTO', isPrimary: true },
        { before: '', after: 'Alfa' },
      ),
    ).toEqual({ position: [null, 'CTO'], isPrimary: [false, true], tagIds: ['', 'Alfa'] });
    expect(contactChanges(before, before, { before: '', after: '' })).toBeNull();
  });

  it('builds the entity ref and the search entry', () => {
    expect(toContactRef(record({}))).toEqual({ type: 'CONTACT', id: 'c1', label: 'Ana' });
    expect(contactSearchEntry(record({}))).toEqual({
      entityType: 'CONTACT',
      entityId: 'c1',
      code: null,
      title: 'Ana',
      subtitle: 'CTO',
      body: 'ana@kairos.example.com +584121234567',
      status: null,
      archived: false,
    });
    expect(
      contactSearchEntry(record({ email: null, phone: null, deletedAt: new Date() })),
    ).toMatchObject({
      body: null,
      archived: true,
    });
  });
});
