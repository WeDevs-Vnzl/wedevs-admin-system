import { describe, expect, it } from 'vitest';
import {
  GLOBAL_GRAPH_DEFAULT_TYPES,
  GRAPH_EXPANSION_LIMIT,
  GRAPH_NODE_TYPE_VALUES,
  GRAPH_RELATION_KEYS,
  buildGraphCursor,
  graphDepth,
  graphNodeId,
  isGraphRelationKey,
  parseGraphCursor,
  parseGraphNodeId,
} from './graph-ids';

describe('§8.12.5 node types', () => {
  it('has exactly the eleven node types of the PRD', () => {
    expect([...GRAPH_NODE_TYPE_VALUES]).toEqual([
      'CLIENT',
      'CONTACT',
      'PROJECT',
      'INVOICE',
      'PAYMENT',
      'EXPENSE',
      'ACCOUNT',
      'DOCUMENT',
      'NOTE',
      'TECHNOLOGY',
      'TAG',
    ]);
  });

  it('the global graph defaults to clients, projects and documents; pages hold 50', () => {
    expect([...GLOBAL_GRAPH_DEFAULT_TYPES]).toEqual(['CLIENT', 'PROJECT', 'DOCUMENT']);
    expect(GRAPH_EXPANSION_LIMIT).toBe(50);
  });
});

describe('node id helpers', () => {
  it('builds `${type}:${entityId}`', () => {
    expect(graphNodeId('PROJECT', 'pry_1')).toBe('PROJECT:pry_1');
  });

  it('parses well-formed ids and rejects the rest', () => {
    expect(parseGraphNodeId('DOCUMENT:doc_1')).toEqual({ type: 'DOCUMENT', entityId: 'doc_1' });
    for (const bad of [
      'doc_1',
      ':doc_1',
      'DOCUMENT:',
      'ROBOT:x',
      'DOCUMENT:bad id',
      `DOCUMENT:${'x'.repeat(65)}`,
    ]) {
      expect(parseGraphNodeId(bad), bad).toBeNull();
    }
    expect(parseGraphNodeId(`DOCUMENT:${'x'.repeat(64)}`)).not.toBeNull();
  });
});

describe('relation keys', () => {
  it('are the stable keys of §8.12.3', () => {
    expect([...GRAPH_RELATION_KEYS]).toEqual([
      'contacto',
      'participa',
      'facturado_a',
      'incluido_en',
      'paga',
      'pago',
      'acreditado_en',
      'pagado_desde',
      'imputado_a',
      'adjunto_a',
      'anotado_en',
      'usa',
      'etiquetado',
    ]);
    expect(isGraphRelationKey('paga')).toBe(true);
    expect(isGraphRelationKey('toString')).toBe(false);
    expect(isGraphRelationKey('nope')).toBe(false);
  });
});

describe('cursor', () => {
  it('is the decimal offset of the next neighbour', () => {
    expect(buildGraphCursor(50)).toBe('50');
    expect(parseGraphCursor('50')).toBe(50);
    expect(parseGraphCursor('0')).toBe(0);
  });

  it('rejects anything but a non-negative integer of at most 256 characters', () => {
    for (const bad of [
      '',
      '-1',
      '1.5',
      'abc',
      '1e3',
      ' 5',
      '+5',
      '9'.repeat(257),
      '9'.repeat(20),
    ]) {
      expect(parseGraphCursor(bad), bad).toBeNull();
    }
  });
});

describe('depth', () => {
  it('defaults to 1 and accepts 1 to 3', () => {
    expect(graphDepth(undefined)).toBe(1);
    expect(graphDepth(3)).toBe(3);
    for (const depth of [0, 4, 1.5]) expect(() => graphDepth(depth), String(depth)).toThrow();
  });
});
