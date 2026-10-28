import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { Authenticated, readRouteGrant, RequiresGrant } from './grant.decorator';
import { Public } from './public.decorator';

class Probe {
  @Public()
  pub(): void {}

  @Authenticated()
  auth(): void {}

  @RequiresGrant('invoice', 'read')
  grant(): void {}

  undeclared(): void {}

  @Public()
  @Authenticated()
  publicAndAuthenticated(): void {}

  @Authenticated()
  @RequiresGrant('client', 'create')
  authenticatedAndGrant(): void {}

  @Public()
  @RequiresGrant('client', 'create')
  publicAndGrant(): void {}
}

@Authenticated()
class ClassLevel {
  inherited(): void {}

  @RequiresGrant('note', 'update')
  withGrant(): void {}

  @Authenticated()
  repeated(): void {}
}

const handler = (cls: new () => object, name: string): (() => void) => {
  const fn = (cls.prototype as Record<string, (() => void) | undefined>)[name];
  if (!fn) throw new Error(`no handler ${name}`);
  return fn;
};

describe('readRouteGrant', () => {
  it('reads each single declaration', () => {
    expect(readRouteGrant(handler(Probe, 'pub'), Probe)).toEqual({ kind: 'public' });
    expect(readRouteGrant(handler(Probe, 'auth'), Probe)).toEqual({ kind: 'authenticated' });
    expect(readRouteGrant(handler(Probe, 'grant'), Probe)).toEqual({
      kind: 'grant',
      resource: 'invoice',
      action: 'read',
    });
  });

  it('reports a handler with no declaration as missing', () => {
    expect(readRouteGrant(handler(Probe, 'undeclared'), Probe)).toEqual({ kind: 'missing' });
  });

  it('reports two different declarations as a conflict', () => {
    for (const name of ['publicAndAuthenticated', 'authenticatedAndGrant', 'publicAndGrant']) {
      expect(readRouteGrant(handler(Probe, name), Probe)).toEqual({ kind: 'conflict' });
    }
  });

  it('inherits a class-level declaration', () => {
    expect(readRouteGrant(handler(ClassLevel, 'inherited'), ClassLevel)).toEqual({
      kind: 'authenticated',
    });
  });

  it('treats the same kind on class and handler as one declaration', () => {
    expect(readRouteGrant(handler(ClassLevel, 'repeated'), ClassLevel)).toEqual({
      kind: 'authenticated',
    });
  });

  it('a handler grant combined with a class-level @Authenticated is a conflict', () => {
    expect(readRouteGrant(handler(ClassLevel, 'withGrant'), ClassLevel)).toEqual({
      kind: 'conflict',
    });
  });
});
