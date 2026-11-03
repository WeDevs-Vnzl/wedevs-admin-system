import { describe, expect, it } from 'vitest';
import * as domainEnums from '../../domain/enums';
import { PrismaEnums as prismaEnums } from './generated-client';

/** Prisma enums owned by a context domain, never exposed in DTOs (data-rules.md §10a, DT-104). */
const CONTEXT_OWNED_ENUMS = [
  'FinanceFactKind',
  'FinanceFactSource',
  'IntegrationProvider',
  'IntegrationEventOutcome',
  'PaymentLinkStatus',
];

const snake = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();

const domainTuples: [string, readonly string[]][] = Object.entries(domainEnums).filter(
  ([name, value]) => name.endsWith('_VALUES') && Array.isArray(value),
) as [string, readonly string[]][];
const prismaByTuple = new Map(
  Object.entries(prismaEnums).map(([name, values]) => [
    `${snake(name)}_VALUES`,
    { name, values: Object.values(values as Record<string, string>) },
  ]),
);

describe('enum parity (data-rules.md §10a)', () => {
  it('finds the domain tuples', () => {
    expect(domainTuples.length).toBeGreaterThan(0);
  });

  it.each(domainTuples)(
    '%s equals its Prisma enum value by value, both directions',
    (tuple, values) => {
      const prisma = prismaByTuple.get(tuple);
      if (!prisma) throw new Error(`no Prisma enum for ${tuple}`);
      const domain = [...values];
      expect(domain.filter((v) => !prisma.values.includes(v))).toEqual([]);
      expect(prisma.values.filter((v) => !domain.includes(v))).toEqual([]);
      expect(domain).toHaveLength(prisma.values.length);
    },
  );

  it('includes the Δ2 ShareEvent additions', () => {
    expect(prismaEnums.ShareEvent.UNLOCK).toBe('UNLOCK');
    expect(prismaEnums.ShareEvent.UNLOCK_FAILED).toBe('UNLOCK_FAILED');
    expect([...domainEnums.SHARE_EVENT_VALUES]).toContain('UNLOCK');
    expect([...domainEnums.SHARE_EVENT_VALUES]).toContain('UNLOCK_FAILED');
  });

  it('every Prisma enum name is a domain tuple or a context-owned enum', () => {
    const tupleNames = new Set(domainTuples.map(([tuple]) => tuple));
    const unaccounted = Object.keys(prismaEnums).filter(
      (name) => !tupleNames.has(`${snake(name)}_VALUES`) && !CONTEXT_OWNED_ENUMS.includes(name),
    );
    expect(unaccounted).toEqual([]);
  });

  it('the context-owned enums exist in Prisma and not in the shared domain', () => {
    for (const name of CONTEXT_OWNED_ENUMS) {
      expect(Object.keys(prismaEnums)).toContain(name);
      expect(domainEnums).not.toHaveProperty(`${snake(name)}_VALUES`);
    }
  });
});
