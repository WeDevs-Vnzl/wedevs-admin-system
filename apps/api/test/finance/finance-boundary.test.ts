import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '../../src/modules/finance');

/** DT-110, rule (e): finance declares its ports; `integrations` binds them. Finance never imports integrations. */
describe('finance depends on nothing from integrations', () => {
  it('has no import of modules/integrations in any source file', () => {
    const offenders = globSync('**/*.ts', { cwd: SRC })
      .filter((file) =>
        /from\s+['"][^'"]*\/integrations\//.test(readFileSync(join(SRC, file), 'utf8')),
      )
      .sort();
    expect(offenders).toEqual([]);
  });
});
