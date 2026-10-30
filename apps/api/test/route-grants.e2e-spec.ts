import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readRouteGrant, type RouteGrant } from '../src/shared/interface/grant.decorator';
import { createTestApp } from './support/test-app';

interface InventoriedRoute {
  readonly route: string;
  readonly grant: RouteGrant['kind'];
  readonly handler: string;
}

const toArray = (value: unknown): string[] => (Array.isArray(value) ? value : [value]) as string[];

function joinPath(...parts: string[]): string {
  const joined = parts
    .flatMap((p) => p.split('/'))
    .filter((segment) => segment.length > 0)
    .join('/');
  return `/${joined}`;
}

/** Every HTTP handler of every controller in the booted app, with its single grant declaration. */
function inventory(app: NestExpressApplication): InventoriedRoute[] {
  const routes: InventoriedRoute[] = [];
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
        const controllerPaths = toArray(Reflect.getMetadata('path', controller) ?? '');
        const handlerPaths = toArray(Reflect.getMetadata('path', handler) ?? '');
        for (const base of controllerPaths) {
          for (const sub of handlerPaths) {
            routes.push({
              route: `${RequestMethod[methodCode]} ${joinPath('api', 'v1', base, sub).replace(/:(\w+)/g, '{$1}')}`,
              grant: readRouteGrant(handler as never, controller).kind,
              handler: `${controller.name}.${name}`,
            });
          }
        }
      }
    }
  }
  return routes.sort((a, b) => a.route.localeCompare(b.route));
}

/** The routes that break the "exactly one declaration" rule (none or two). */
const violations = (routes: InventoriedRoute[]): InventoriedRoute[] =>
  routes.filter((r) => r.grant === 'missing' || r.grant === 'conflict');

describe('route inventory (full AppModule)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({ probes: false });
  });
  afterAll(async () => {
    await app.close();
  });

  it('finds the routes of every context and none without exactly one declaration', () => {
    const routes = inventory(app);
    expect(routes.length).toBeGreaterThan(15);
    expect(violations(routes)).toEqual([]);
  });

  it('the @Public() set is exactly health and the Clerk webhook (api-contract.md §5)', () => {
    const publicRoutes = inventory(app)
      .filter((r) => r.grant === 'public')
      .map((r) => r.route);
    expect(publicRoutes.sort()).toEqual(['GET /api/v1/health', 'POST /api/v1/webhooks/clerk']);
  });

  it('inventories every BE-2 handler with exactly one grant, the note archive as @Authenticated()', () => {
    const routes = inventory(app);
    const byRoute = new Map(routes.map((r) => [r.route, r.grant]));
    for (const route of [
      'GET /api/v1/clients',
      'POST /api/v1/clients/{id}/contacts',
      'GET /api/v1/projects',
      'PUT /api/v1/projects/{id}/links',
      'GET /api/v1/notes',
      'POST /api/v1/notes/{id}/restore',
      'GET /api/v1/technologies',
      'POST /api/v1/tags/assign',
      'GET /api/v1/trash',
      'POST /api/v1/trash/restore',
      'GET /api/v1/activity',
    ]) {
      expect(byRoute.has(route), route).toBe(true);
    }
    expect(byRoute.get('POST /api/v1/notes/{id}/archive')).toBe('authenticated');
    expect(byRoute.get('GET /api/v1/projects')).toBe('grant');
  });

  it('exposes no PATCH, PUT or DELETE under /activity (the log is append-only, HU-29 CA2)', () => {
    const mutating = inventory(app).filter((r) =>
      /^(PATCH|PUT|DELETE) \/api\/v1\/activity/.test(r.route),
    );
    expect(mutating).toEqual([]);
  });

  it('every inventoried route is a real route of the OpenAPI document and vice versa', async () => {
    const res = await request(app.getHttpServer()).get('/api/openapi.json').expect(200);
    const documented = Object.entries(
      res.body.paths as Record<string, Record<string, unknown>>,
    ).flatMap(([path, methods]) => Object.keys(methods).map((m) => `${m.toUpperCase()} ${path}`));
    expect(
      inventory(app)
        .map((r) => r.route)
        .sort(),
    ).toEqual(documented.sort());
  });
});

describe('route inventory detects an undeclared or double-declared route', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp(); // mounts ProbeModule, which plants both violations
  });
  afterAll(async () => {
    await app.close();
  });

  it('reports the planted fixture routes', () => {
    const planted = violations(inventory(app)).map((r) => `${r.route}:${r.grant}`);
    expect(planted).toEqual([
      'GET /api/v1/probe/auth/double:conflict',
      'GET /api/v1/probe/auth/undeclared:missing',
    ]);
  });
});
