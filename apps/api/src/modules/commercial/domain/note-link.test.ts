import { describe, expect, it } from 'vitest';
import {
  assertDistinctLinks,
  clientScopeOf,
  isOwnNoteLinkType,
  linkKey,
  sameLink,
  type NoteLinkTarget,
} from './note-link';

const client = (id: string): NoteLinkTarget => ({ entityType: 'CLIENT', entityId: id });
const project = (id: string): NoteLinkTarget => ({ entityType: 'PROJECT', entityId: id });

describe('note links', () => {
  it('knows which target types commercial owns', () => {
    expect(isOwnNoteLinkType('CLIENT')).toBe(true);
    expect(isOwnNoteLinkType('CONTACT')).toBe(true);
    expect(isOwnNoteLinkType('PROJECT')).toBe(true);
    expect(isOwnNoteLinkType('INVOICE')).toBe(false);
  });

  it('builds a stable key and compares targets by type and id', () => {
    expect(linkKey(client('a'))).toBe('CLIENT:a');
    expect(sameLink(client('a'), client('a'))).toBe(true);
    expect(sameLink(client('a'), project('a'))).toBe(false);
  });

  it('refuses a repeated target as validation.invalidOption on the field', () => {
    expect(() => assertDistinctLinks([client('a'), project('b')])).not.toThrow();
    expect(() => assertDistinctLinks([client('a'), client('a')])).toThrowError(
      expect.objectContaining({
        code: 'VALIDATION',
        fieldErrors: { links: ['validation.invalidOption'] },
      }),
    );
  });

  it('scopes the activity to the first client target and touches every client target', () => {
    expect(clientScopeOf([project('p'), client('c1'), client('c2')])).toEqual({
      clientId: 'c1',
      touchClientIds: ['c1', 'c2'],
    });
    expect(clientScopeOf([project('p')])).toEqual({ clientId: null, touchClientIds: [] });
  });
});
