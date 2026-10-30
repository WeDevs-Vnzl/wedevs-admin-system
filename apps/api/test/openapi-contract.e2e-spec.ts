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
});
