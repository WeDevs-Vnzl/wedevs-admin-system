/**
 * CommonJS require hook that compiles `.ts` with SWC and emits decorator metadata, which Nest needs to resolve
 * constructor injection by type. `tsx` (esbuild) does not emit it, so a script that boots the Nest
 * application context runs through this hook instead: `node --require ./scripts/swc-register.cjs <script>.ts`.
 * The options match `vitest.config.ts`, with CommonJS output.
 */
/* eslint-disable @typescript-eslint/no-require-imports, no-undef -- a CommonJS hook loaded by `node --require` */
const fs = require('node:fs');
const Module = require('node:module');
const { transformSync } = require('@swc/core');

const options = {
  module: { type: 'commonjs' },
  sourceMaps: 'inline',
  jsc: {
    target: 'es2023',
    parser: { syntax: 'typescript', decorators: true },
    transform: { legacyDecorator: true, decoratorMetadata: true },
  },
};

// `nodenext` sources import siblings as `./x.js` (e.g. the generated Prisma client): resolve those to `./x.ts`.
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveTs(request, parent, ...rest) {
  try {
    return resolveFilename.call(this, request, parent, ...rest);
  } catch (error) {
    if (request.startsWith('.') && request.endsWith('.js')) {
      return resolveFilename.call(this, `${request.slice(0, -3)}.ts`, parent, ...rest);
    }
    throw error;
  }
};

Module._extensions['.ts'] = function compileTs(module, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const { code } = transformSync(source, { ...options, filename });
  module._compile(code, filename);
};
