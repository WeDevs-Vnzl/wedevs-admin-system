import type { DynamicModule, Type } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { JobsModule } from '../../src/modules/jobs/jobs.module';
import { WorkerModule } from '../../src/worker.module';

type ModuleRef = Type<unknown> | DynamicModule;

function reachable(root: ModuleRef, seen = new Set<Type<unknown>>()): Set<Type<unknown>> {
  const type = 'module' in root ? root.module : root;
  if (seen.has(type)) return seen;
  seen.add(type);
  const imports = [
    ...((Reflect.getMetadata('imports', type) as ModuleRef[] | undefined) ?? []),
    ...('module' in root ? (root.imports ?? []) : []),
  ] as ModuleRef[];
  for (const child of imports) reachable(child, seen);
  return seen;
}

describe('who imports JobsModule (DT-169)', () => {
  it('the API process never reaches JobsModule', () => {
    expect(reachable(AppModule).has(JobsModule)).toBe(false);
  });

  it('the worker reaches it', () => {
    expect(reachable(WorkerModule).has(JobsModule)).toBe(true);
  });
});
