import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RequestMethod } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './support/test-app';

/** `RouteParamtypes` of @nestjs/common, which does not export the enum. */
const BODY = 3;
const QUERY = 4;
const ROUTE_ARGS_METADATA = '__routeArguments__';

interface Parameter {
  readonly name: string;
  readonly in: string;
}
interface Operation {
  readonly parameters?: readonly Parameter[];
  readonly requestBody?: unknown;
}
type Document = { paths: Record<string, Record<string, Operation>> };

interface ExpectedRoute {
  readonly label: string;
  readonly path: string;
  readonly method: string;
  readonly pathParams: string[];
  readonly queryDto: unknown;
  readonly hasBody: boolean;
}

const DOCUMENT = JSON.parse(
  readFileSync(
    resolve(__dirname, '..', '..', '..', 'packages', 'api-contract', 'openapi.json'),
    'utf8',
  ),
) as Document;

const toArray = (value: unknown): string[] => (Array.isArray(value) ? value : [value]) as string[];

function joinPath(...parts: string[]): string {
  const joined = parts
    .flatMap((p) => p.split('/'))
    .filter((segment) => segment.length > 0)
    .join('/');
  return `/${joined}`;
}

/** Property names of a nestjs-zod DTO (`createZodDto` exposes the schema), or undefined when not introspectable. */
function dtoKeys(dto: unknown): string[] | undefined {
  const schema = (dto as { schema?: { shape?: Record<string, unknown> } } | undefined)?.schema;
  return schema?.shape ? Object.keys(schema.shape) : undefined;
}

/** What each handler declares through Nest route metadata, the source of truth the document must reflect. */
function expectedRoutes(app: NestExpressApplication): ExpectedRoute[] {
  const routes: ExpectedRoute[] = [];
  const container = app.get(ModulesContainer, { strict: false });
  for (const module of container.values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype;
      if (!controller) continue;
      const prototype = controller.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(prototype)) {
        const handler = prototype[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        const methodCode = Reflect.getMetadata('method', handler) as RequestMethod | undefined;
        if (methodCode === undefined) continue;
        const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, name) ?? {}) as Record<
          string,
          { index: number }
        >;
        const types = (Reflect.getMetadata('design:paramtypes', prototype, name) ??
          []) as unknown[];
        const argOf = (kind: number) =>
          Object.entries(args).find(([key]) => key.startsWith(`${kind}:`))?.[1];
        const query = argOf(QUERY);
        const controllerPaths = toArray(Reflect.getMetadata('path', controller) ?? '');
        const handlerPaths = toArray(Reflect.getMetadata('path', handler) ?? '');
        for (const base of controllerPaths) {
          for (const sub of handlerPaths) {
            const path = joinPath('api', 'v1', base, sub).replace(/:(\w+)/g, '{$1}');
            routes.push({
              label: `${controller.name}.${name}`,
              path,
              method: String(RequestMethod[methodCode]).toLowerCase(),
              pathParams: [...path.matchAll(/\{(\w+)\}/g)].flatMap((m) => (m[1] ? [m[1]] : [])),
              queryDto: query ? types[query.index] : undefined,
              hasBody: argOf(BODY) !== undefined,
            });
          }
        }
      }
    }
  }
  return routes;
}

/** Every BE-3 finance operation: the paths of the plan's contract choice 1 (`TASK-BE.md` BE-3). */
const FINANCE_PATH =
  /^\/api\/v1\/(exchange-rates|invoices|payments|allocations|installments|recurring-charges|recurring-expenses|expenses|accounts|transfers|projects\/\{id\}\/(billing|installments|recurring-charges)|clients\/\{id\}\/(billable-installments|open-invoices|credit))/;

/** `decimalStringSchema` of the response DTOs (C8, C15). */
const DECIMAL_PATTERN = '^-?(?:0|[1-9]\\d*)(?:\\.\\d+)?$';
/** A percent in a request keeps its own, tighter pattern (0 to 999.99); its response is a plain decimal. */
const PERCENT_PATTERN = '^\\d{1,3}(?:\\.\\d{1,2})?$';

/**
 * The only integer properties finance may expose (counts, pages, days and ordinals, never an amount).
 * A JSON `number` is never allowed; an `integer` is allowed only under one of these names.
 */
const INTEGER_ALLOWLIST: ReadonlySet<string> = new Set([
  'page',
  'pageSize',
  'pageCount',
  'total',
  'daysOverdue',
  'billingDay',
  'dayOfPeriod',
  'leadDays',
  'order',
  'created',
  'updated',
  'skipped',
  'row',
  'sizeBytes',
]);

/** Names that carry a money amount, a rate or a percent; dates, notes, flags and ids are not. */
const MONEY_NAME =
  /(amount|total|price|balance|rate|fee|igtf|iva|discount|credit|paid|allocated|net|tax|percent|usd|withheld|difference|adjustment|quantity|receivable|allocatable)/i;
const NOT_MONEY_NAME = /(At|Note|Date|Start|Id)$|^has[A-Z]|^(pageCount|created|updated)$/;

const SCALAR_TYPES: ReadonlySet<string> = new Set([
  'string',
  'number',
  'integer',
  'boolean',
  'null',
]);

type JsonSchema = Record<string, unknown>;
interface FullDocument {
  paths: Record<string, Record<string, Record<string, unknown>>>;
  components: { schemas: Record<string, JsonSchema> };
}

const typesOf = (schema: JsonSchema): string[] => [schema.type].flat().filter(Boolean) as string[];

/**
 * Walks the request and response schemas of every finance operation and reports each money, rate or percent
 * property that is not a decimal string and each JSON number or non-allowlisted integer (lesson 4).
 * Request and response money fields must be `type: string` with the decimal pattern (requests carry it as
 * `.meta()`, their Zod refinements stay the only runtime check). Nullable ones are `string | null`.
 */
function financeContractFindings(doc: FullDocument): string[] {
  const findings = new Set<string>();
  const resolve = (node: JsonSchema): JsonSchema => {
    const ref = node.$ref;
    return typeof ref === 'string'
      ? (doc.components.schemas[ref.split('/').pop() ?? ''] ?? {})
      : node;
  };
  const visit = (
    input: JsonSchema,
    name: string,
    side: 'request' | 'response',
    where: string,
    seen: readonly string[],
  ): void => {
    const ref = typeof input.$ref === 'string' ? input.$ref : undefined;
    if (ref && seen.includes(ref)) return;
    const node = resolve(input);
    const path = ref ? [...seen, ref] : seen;
    const types = typesOf(node);
    const money = name !== '' && MONEY_NAME.test(name) && !NOT_MONEY_NAME.test(name);
    if (types.includes('number')) findings.add(`${where}: ${name || '(root)'} is a JSON number`);
    if (types.includes('integer') && !INTEGER_ALLOWLIST.has(name)) {
      findings.add(`${where}: ${name || '(root)'} is an integer outside the allowlist`);
    }
    // An array of scalars is the lossy nullable shape (`string[]` for `string | null`); objects and arrays of
    // objects are containers (`totals`, `taxLines`) whose members are visited on their own.
    const shape = types.includes('array')
      ? ['array', ...typesOf(resolve((node.items ?? {}) as JsonSchema))]
      : types;
    const scalar = shape.length > 0 && shape.every((t) => SCALAR_TYPES.has(t) || t === 'array');
    const counter = types.includes('integer') && INTEGER_ALLOWLIST.has(name);
    if (money && scalar && !counter && !shape.every((t) => t === 'string' || t === 'null')) {
      findings.add(`${where}: ${name} is money but typed ${types.join('|')}`);
    }
    const expected =
      side === 'request' && name === 'percentage' ? PERCENT_PATTERN : DECIMAL_PATTERN;
    if (money && types.includes('string') && node.pattern !== expected) {
      findings.add(`${where}: ${name} misses the decimal pattern (${side})`);
    }
    for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
      for (const branch of (node[key] as JsonSchema[] | undefined) ?? [])
        visit(branch, name, side, where, path);
    }
    if (node.items) visit(node.items as JsonSchema, name, side, where, path);
    for (const [key, value] of Object.entries(
      (node.properties ?? {}) as Record<string, JsonSchema>,
    )) {
      visit(value, key, side, where, path);
    }
    if (node.additionalProperties && typeof node.additionalProperties === 'object') {
      visit(node.additionalProperties as JsonSchema, name, side, where, path);
    }
  };
  for (const [path, methods] of Object.entries(doc.paths)) {
    if (!FINANCE_PATH.test(path)) continue;
    for (const [method, operation] of Object.entries(methods)) {
      const where = `${method.toUpperCase()} ${path}`;
      for (const parameter of (operation.parameters ?? []) as {
        name: string;
        schema: JsonSchema;
      }[]) {
        visit(parameter.schema, parameter.name, 'request', where, []);
      }
      const bodies = (operation.requestBody as { content?: Record<string, { schema: JsonSchema }> })
        ?.content;
      for (const media of Object.values(bodies ?? {}))
        visit(media.schema, '', 'request', where, []);
      for (const response of Object.values(
        (operation.responses ?? {}) as Record<
          string,
          { content?: Record<string, { schema: JsonSchema }> }
        >,
      )) {
        for (const media of Object.values(response.content ?? {}))
          visit(media.schema, '', 'response', where, []);
      }
    }
  }
  return [...findings].sort();
}

describe('finance contract: money is a decimal string, never a JSON number (lesson 4)', () => {
  const full = DOCUMENT as unknown as FullDocument;
  const clone = (): FullDocument => structuredClone(full);
  const plant = (doc: FullDocument, schema: string, property: string, value: JsonSchema): void => {
    const target = doc.components.schemas[schema];
    if (!target) throw new Error(`${schema} is not in the document`);
    target.properties = { ...(target.properties as Record<string, JsonSchema>), [property]: value };
  };

  it('covers every finance operation of the document (57)', () => {
    const operations = Object.entries(full.paths)
      .filter(([path]) => FINANCE_PATH.test(path))
      .flatMap(([, methods]) => Object.keys(methods));
    expect(operations).toHaveLength(57);
  });

  it('finds no JSON number, no money that is not a decimal string and no integer off the allowlist', () => {
    expect(financeContractFindings(full)).toEqual([]);
  });

  it('flags a money property planted as a JSON number', () => {
    const doc = clone();
    plant(doc, 'InvoiceResponseDto', 'totalUsd', { type: 'number' });
    expect(financeContractFindings(doc)).toContain(
      'POST /api/v1/invoices: totalUsd is a JSON number',
    );
  });

  it('flags a money request field planted as an integer, and an integer off the allowlist', () => {
    const doc = clone();
    plant(doc, 'CreateAccountDto', 'openingBalance', { type: 'integer' });
    plant(doc, 'InvoiceResponseDto', 'daysLate', { type: 'integer' });
    const findings = financeContractFindings(doc);
    expect(findings).toContain('POST /api/v1/accounts: openingBalance is money but typed integer');
    expect(findings).toContain(
      'GET /api/v1/invoices/{id}: daysLate is an integer outside the allowlist',
    );
  });

  it('flags a request or response money string that lost its decimal pattern, and a nullable one typed as an array', () => {
    const doc = clone();
    plant(doc, 'CreateAccountDto', 'openingBalance', { type: 'string' });
    plant(doc, 'InvoiceResponseDto', 'totalUsd', { type: 'string' });
    plant(doc, 'InvoiceResponseDto', 'discount', {
      type: 'array',
      items: { type: 'string' },
    });
    const findings = financeContractFindings(doc);
    expect(findings).toContain(
      'POST /api/v1/accounts: openingBalance misses the decimal pattern (request)',
    );
    expect(findings).toContain(
      'GET /api/v1/invoices/{id}: totalUsd misses the decimal pattern (response)',
    );
    expect(findings).toContain('GET /api/v1/invoices/{id}: discount is money but typed array');
  });

  it('documents pageSize as 25 | 50 | 100 and sort as the whitelist on every finance list (m3)', () => {
    const lists = Object.entries(full.paths).flatMap(([path, methods]) =>
      Object.entries(methods)
        .filter(([, op]) =>
          ((op.parameters ?? []) as { name: string }[]).some((p) => p.name === 'pageSize'),
        )
        .map(([method, op]) => ({ where: `${method.toUpperCase()} ${path}`, op })),
    );
    expect(lists.filter(({ where }) => FINANCE_PATH.test(where.split(' ')[1] ?? '')).length).toBe(
      7,
    );
    const weak = lists.flatMap(({ where, op }) => {
      const params = op.parameters as { name: string; schema: JsonSchema }[];
      const pageSize = params.find((p) => p.name === 'pageSize')?.schema;
      const sort = params.find((p) => p.name === 'sort')?.schema;
      return [
        ...(pageSize?.type === 'integer' &&
        JSON.stringify(pageSize.enum) === JSON.stringify([25, 50, 100])
          ? []
          : [`${where}: pageSize is not the 25|50|100 integer enum`]),
        ...(sort && Array.isArray(sort.enum) && sort.enum.length > 0
          ? []
          : [`${where}: sort is not the whitelisted enum`]),
      ];
    });
    expect(weak).toEqual([]);
  });
});

/** Every BE-4 operation: documents, share links and the portal (`TASK-BE.md` BE-4 contract choice 1). */
const BE4_PATH = /^\/api\/v1\/(documents|share-links|portal)(\/|$)/;

/** Names that would carry a secret or a hash: an access key, a scrypt hash, an IP hash, a salt, a storage key. */
const SECRET_NAME = /(key|hash|secret|scrypt|salt)/i;
/** Flags and timestamps about a key, never the key itself. */
const KEY_METADATA: ReadonlySet<string> = new Set(['requiresAccessKey', 'accessKeyUpdatedAt']);
/** The one-time reveal of a generated key: only the mutation results of a share link carry it (HU-22). */
const KEY_REVEAL: ReadonlySet<string> = new Set(['accessKey', 'generatedKeys']);

/** Property names reachable from the response schemas of one operation. */
function responseProperties(doc: FullDocument, operation: Record<string, unknown>): string[] {
  const names = new Set<string>();
  const visit = (node: JsonSchema | undefined, seen: readonly string[]): void => {
    if (!node) return;
    const ref = typeof node.$ref === 'string' ? node.$ref : undefined;
    if (ref) {
      if (seen.includes(ref)) return;
      visit(doc.components.schemas[ref.split('/').pop() ?? ''], [...seen, ref]);
      return;
    }
    for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
      for (const branch of (node[key] as JsonSchema[] | undefined) ?? []) visit(branch, seen);
    }
    if (node.items) visit(node.items as JsonSchema, seen);
    for (const [name, value] of Object.entries(
      (node.properties ?? {}) as Record<string, JsonSchema>,
    )) {
      names.add(name);
      visit(value, seen);
    }
  };
  for (const response of Object.values(
    (operation.responses ?? {}) as Record<
      string,
      { content?: Record<string, { schema: JsonSchema }> }
    >,
  )) {
    for (const media of Object.values(response.content ?? {})) visit(media.schema, []);
  }
  return [...names];
}

/** Response properties that look like a secret, outside the allowed key metadata and the mutation reveal. */
function secretFindings(doc: FullDocument): string[] {
  const findings: string[] = [];
  for (const [path, methods] of Object.entries(doc.paths)) {
    if (!BE4_PATH.test(path)) continue;
    for (const [method, operation] of Object.entries(methods)) {
      const mutation = path.startsWith('/api/v1/share-links') && method !== 'get';
      for (const name of responseProperties(doc, operation)) {
        if (!SECRET_NAME.test(name) || KEY_METADATA.has(name)) continue;
        if (KEY_REVEAL.has(name) && mutation) continue;
        findings.push(`${method.toUpperCase()} ${path}: ${name}`);
      }
    }
  }
  return findings.sort();
}

describe('BE-4 contract: documents, share links and the portal', () => {
  const full = DOCUMENT as unknown as FullDocument;
  const be4Operations = Object.entries(full.paths)
    .filter(([path]) => BE4_PATH.test(path))
    .flatMap(([path, methods]) =>
      Object.entries(methods).map(([method, operation]) => ({ path, method, operation })),
    );

  it('documents the 29 BE-4 operations', () => {
    expect(be4Operations).toHaveLength(29);
  });

  it('declares a bearer requirement on every authenticated BE-4 operation by inheriting the global one (C13)', () => {
    const authenticated = be4Operations.filter(({ path }) => !path.startsWith('/api/v1/portal'));
    expect(authenticated.filter(({ operation }) => operation.security !== undefined)).toEqual([]);
  });

  // Blocked: the five @ApiOperation of PortalController lack `security: []` (as health and the Clerk webhook
  // have), so the document still inherits the global bearer for them. Needs portal.controller.ts, outside 5.1.
  it.todo('declares no bearer requirement (security: []) on the five portal operations (C24)');

  it('exposes no access key, hash or secret in a response except accessKey and generatedKeys of the share-link mutations', () => {
    expect(secretFindings(full)).toEqual([]);
  });

  it('flags a hash planted in a portal response and a key revealed by a GET', () => {
    const doc = structuredClone(full);
    const schemas = doc.components.schemas;
    const target = schemas.ShareLinkDetailDto;
    if (!target) throw new Error('ShareLinkDetailDto is not in the document');
    target.properties = {
      ...(target.properties as Record<string, JsonSchema>),
      accessKeyHash: { type: 'string' },
      accessKey: { type: 'string' },
    };
    const findings = secretFindings(doc);
    expect(findings).toContain('GET /api/v1/share-links/{id}: accessKeyHash');
    expect(findings).toContain('GET /api/v1/share-links/{id}: accessKey');
  });

  it('documents pageSize as 25 | 50 | 100 and sort as the whitelist on every new list', () => {
    const lists = be4Operations.filter(({ operation }) =>
      ((operation.parameters ?? []) as { name: string }[]).some((p) => p.name === 'pageSize'),
    );
    expect(lists.map(({ method, path }) => `${method} ${path}`).sort()).toEqual([
      'get /api/v1/documents',
      'get /api/v1/documents/category-counts',
      'get /api/v1/share-links',
      'get /api/v1/share-links/{id}/access-log',
    ]);
    const weak = lists.flatMap(({ method, path, operation }) => {
      const params = operation.parameters as { name: string; schema: JsonSchema }[];
      const pageSize = params.find((p) => p.name === 'pageSize')?.schema;
      const sort = params.find((p) => p.name === 'sort')?.schema;
      const where = `${method.toUpperCase()} ${path}`;
      return [
        ...(pageSize?.type === 'integer' &&
        JSON.stringify(pageSize.enum) === JSON.stringify([25, 50, 100])
          ? []
          : [`${where}: pageSize is not the 25|50|100 integer enum`]),
        ...(sort && Array.isArray(sort.enum) && sort.enum.length > 0
          ? []
          : [`${where}: sort is not the whitelisted enum`]),
      ];
    });
    expect(weak).toEqual([]);
  });
});

describe('OpenAPI document reflects the route metadata (committed packages/api-contract/openapi.json)', () => {
  let routes: ExpectedRoute[];
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({ probes: false });
    routes = expectedRoutes(app);
  });
  afterAll(async () => {
    await app.close();
  });

  const operationOf = (route: ExpectedRoute): Operation => {
    const operation = DOCUMENT.paths[route.path]?.[route.method];
    if (!operation)
      throw new Error(`${route.label}: ${route.method} ${route.path} is not in the document`);
    return operation;
  };

  it('documents every route of the booted app', () => {
    expect(routes.length).toBeGreaterThan(15);
    const missing = routes.filter((r) => !DOCUMENT.paths[r.path]?.[r.method]).map((r) => r.label);
    expect(missing).toEqual([]);
  });

  it('declares an in:path parameter for every {param} of a templated path', () => {
    const missing = routes.flatMap((route) =>
      route.pathParams
        .filter((p) => !operationOf(route).parameters?.some((x) => x.in === 'path' && x.name === p))
        .map((p) => `${route.label}: ${route.path} misses path param ${p}`),
    );
    expect(missing).toEqual([]);
  });

  it('declares requestBody for every operation with a @Body() parameter', () => {
    const missing = routes
      .filter((route) => route.hasBody && operationOf(route).requestBody === undefined)
      .map((route) => `${route.label}: ${route.method} ${route.path} misses requestBody`);
    expect(missing).toEqual([]);
  });

  it('declares the query parameters of every @Query() DTO', () => {
    const missing = routes.flatMap((route) => {
      if (route.queryDto === undefined) return [];
      const declared = (operationOf(route).parameters ?? []).filter((x) => x.in === 'query');
      const keys = dtoKeys(route.queryDto);
      if (declared.length === 0) return [`${route.label}: no query parameter declared`];
      return (keys ?? [])
        .filter((key) => !declared.some((x) => x.name === key))
        .map((key) => `${route.label}: query param ${key} is missing`);
    });
    expect(missing).toEqual([]);
  });

  it('types the nullable imageUrl of the user DTOs identically, as string | null (Q-FEINT-1)', () => {
    type Schemas = Record<string, { properties?: Record<string, unknown> }>;
    const schemas = (DOCUMENT as unknown as { components: { schemas: Schemas } }).components
      .schemas;
    const row = (
      schemas.UserListResponseDto?.properties?.items as {
        items: { properties: Record<string, unknown> };
      }
    ).items.properties.imageUrl;
    expect(row).toEqual({ type: ['string', 'null'] });
    expect(schemas.UserDetailDto?.properties?.imageUrl).toEqual(row);
  });
});
