import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readRouteGrant, type RouteGrant } from '../src/shared/interface/grant.decorator';
import { MatrixAuthorization } from '../src/modules/identity/application/matrix-authorization';
import type { CurrentUser } from '../src/shared/application/current-user';
import { AUTHORIZATION } from '../src/shared/application/ports/tokens';
import { FakeAuthenticator } from './support/fakes/fake-authenticator';
import { createTestApp } from './support/test-app';

interface InventoriedRoute {
  readonly route: string;
  readonly grant: RouteGrant['kind'];
  /** `resource:action` of a `grant` route, undefined for the other kinds. */
  readonly requirement?: string;
  readonly handler: string;
}

/**
 * Every BE-3 finance route with the grant its handler declares (TASK-BE.md BE-3 contract choice 1, PRD §4).
 * Member and Viewer get FORBIDDEN on all of them because the matrix grants them no finance resource (C13).
 */
const FINANCE_ROUTES: Readonly<Record<string, string>> = {
  'GET /api/v1/exchange-rates': 'settings:read',
  'POST /api/v1/exchange-rates': 'settings:update',
  'POST /api/v1/exchange-rates/daily': 'settings:update',
  'POST /api/v1/exchange-rates/import': 'settings:update',
  'GET /api/v1/exchange-rates/lookup': 'authenticated',
  'GET /api/v1/projects/{id}/billing': 'billing:read',
  'PUT /api/v1/projects/{id}/billing-plan': 'billing:update',
  'POST /api/v1/projects/{id}/billing-plan/template': 'billing:create',
  'POST /api/v1/projects/{id}/installments': 'billing:create',
  'PATCH /api/v1/installments/{id}': 'billing:update',
  'POST /api/v1/installments/{id}/cancel': 'billing:update',
  'POST /api/v1/projects/{id}/recurring-charges': 'billing:create',
  'PATCH /api/v1/recurring-charges/{id}': 'billing:update',
  'POST /api/v1/recurring-charges/{id}/status': 'billing:update',
  'POST /api/v1/recurring-charges/{id}/generate-missing-periods': 'billing:create',
  'GET /api/v1/invoices': 'invoice:read',
  'POST /api/v1/invoices': 'invoice:create',
  'GET /api/v1/invoices/{id}': 'invoice:read',
  'PATCH /api/v1/invoices/{id}': 'invoice:update',
  'POST /api/v1/invoices/{id}/issue': 'invoice:update',
  'POST /api/v1/invoices/{id}/void': 'invoice:update',
  'POST /api/v1/invoices/{id}/archive': 'invoice:delete',
  'POST /api/v1/invoices/{id}/restore': 'invoice:restore',
  'PUT /api/v1/invoices/{id}/file': 'invoice:update',
  'GET /api/v1/clients/{id}/billable-installments': 'invoice:read',
  'GET /api/v1/clients/{id}/open-invoices': 'invoice:read',
  'GET /api/v1/payments': 'payment:read',
  'POST /api/v1/payments': 'payment:create',
  'GET /api/v1/payments/duplicates': 'payment:read',
  'GET /api/v1/payments/{id}': 'payment:read',
  'PATCH /api/v1/payments/{id}': 'payment:update',
  'POST /api/v1/payments/{id}/status': 'payment:update',
  'POST /api/v1/payments/{id}/allocations': 'payment:update',
  'POST /api/v1/allocations/{id}/deallocate': 'payment:update',
  'GET /api/v1/clients/{id}/credit': 'payment:read',
  'GET /api/v1/invoices/{id}/payment-context': 'payment:read',
  'GET /api/v1/accounts': 'account:read',
  'GET /api/v1/accounts/partners': 'account:read',
  'POST /api/v1/accounts': 'account:create',
  'GET /api/v1/accounts/{id}': 'account:read',
  'PATCH /api/v1/accounts/{id}': 'account:update',
  'GET /api/v1/accounts/{id}/ledger': 'account:read',
  'GET /api/v1/accounts/{id}/balance': 'account:read',
  'POST /api/v1/accounts/{id}/reconcile': 'account:update',
  'POST /api/v1/accounts/{id}/movements': 'account:create',
  'POST /api/v1/transfers': 'account:create',
  'GET /api/v1/expenses': 'expense:read',
  'POST /api/v1/expenses': 'expense:create',
  'GET /api/v1/expenses/{id}': 'expense:read',
  'PATCH /api/v1/expenses/{id}': 'expense:update',
  'POST /api/v1/expenses/{id}/pay': 'expense:update',
  'POST /api/v1/expenses/{id}/void': 'expense:update',
  'GET /api/v1/recurring-expenses': 'expense:read',
  'POST /api/v1/recurring-expenses': 'expense:create',
  'GET /api/v1/recurring-expenses/{id}': 'expense:read',
  'PATCH /api/v1/recurring-expenses/{id}': 'expense:update',
  'POST /api/v1/recurring-expenses/{id}/status': 'expense:update',
};

/** Every BE-4 route with the grant its handler declares (TASK-BE.md BE-4 contract choice 1, PRD §4.3). */
const BE4_ROUTES: Readonly<Record<string, string>> = {
  'GET /api/v1/documents': 'document:read',
  'POST /api/v1/documents': 'document:create',
  'GET /api/v1/documents/category-counts': 'document:read',
  'POST /api/v1/documents/archive': 'document:delete',
  'GET /api/v1/documents/{id}': 'document:read',
  'PATCH /api/v1/documents/{id}': 'document:update',
  'POST /api/v1/documents/{id}/status': 'document:update',
  'POST /api/v1/documents/{id}/archive': 'document:delete',
  'POST /api/v1/documents/{id}/restore': 'document:restore',
  'POST /api/v1/documents/{id}/links': 'document:update',
  'DELETE /api/v1/documents/{id}/links/{entityType}/{entityId}': 'document:update',
  'PUT /api/v1/documents/{id}/draft': 'document:update',
  'GET /api/v1/documents/{id}/versions': 'document:read',
  'GET /api/v1/documents/{id}/versions/{versionId}': 'document:read',
  'POST /api/v1/documents/{id}/versions': 'document:update',
  'POST /api/v1/documents/{id}/versions/publish': 'document:update',
  'POST /api/v1/documents/{id}/versions/{versionId}/restore': 'document:update',
  'GET /api/v1/share-links': 'share:read',
  'POST /api/v1/share-links': 'share:create',
  'GET /api/v1/share-links/{id}': 'share:read',
  'PATCH /api/v1/share-links/{id}': 'share:update',
  'POST /api/v1/share-links/{id}/revoke': 'share:update',
  'POST /api/v1/share-links/{id}/documents/{documentId}/access-key': 'share:update',
  'GET /api/v1/share-links/{id}/access-log': 'share:read',
  'GET /api/v1/portal/{token}': 'public',
  'POST /api/v1/portal/{token}/views': 'public',
  'POST /api/v1/portal/{token}/documents/{documentId}/unlock': 'public',
  'GET /api/v1/portal/{token}/documents/{documentId}': 'public',
  'GET /api/v1/portal/{token}/files/{documentId}': 'public',
};

/**
 * Every BE-5 `intelligence` route with the grant its handler declares (TASK-BE.md BE-5 contract choices, PRD
 * §4). The per-record-type routes are `@Authenticated()` because the use case decides by type (C13, C14).
 */
const BE5_ROUTES: Readonly<Record<string, string>> = {
  'GET /api/v1/shell': 'authenticated',
  'GET /api/v1/dashboard': 'authenticated',
  'GET /api/v1/clients/overview': 'client:read',
  'GET /api/v1/projects/overview': 'project:read',
  'GET /api/v1/invoices/overview': 'invoice:read',
  'GET /api/v1/payments/overview': 'payment:read',
  'GET /api/v1/expenses/overview': 'expense:read',
  'GET /api/v1/accounts/overview': 'account:read',
  'GET /api/v1/documents/overview': 'document:read',
  'GET /api/v1/activity/overview': 'activity:read',
  'GET /api/v1/clients/{id}/summary': 'client:read',
  'GET /api/v1/projects/{id}/summary': 'project:read',
  'GET /api/v1/reports/kpis': 'report:read',
  'GET /api/v1/reports/{slug}': 'report:read',
  'GET /api/v1/alerts': 'authenticated',
  'POST /api/v1/alerts/read': 'authenticated',
  'POST /api/v1/alerts/{key}/read': 'authenticated',
  'POST /api/v1/alerts/{key}/dismiss': 'authenticated',
  'POST /api/v1/alerts/{key}/restore': 'authenticated',
  'GET /api/v1/search': 'authenticated',
  'GET /api/v1/graph': 'authenticated',
  'GET /api/v1/graph/{type}/{id}': 'authenticated',
  'GET /api/v1/graph/nodes/{nodeId}/neighbours': 'authenticated',
  'POST /api/v1/exports/{entity}': 'authenticated',
};

/**
 * Every BE-6 `integrations` and `mcp` route with the grant its handler declares (TASK-BE.md BE-6 contract
 * choices, DT-190). `POST /webhooks/stripe` is the only new `@Public()`; `POST /mcp` is `@Authenticated()` through
 * the MCP authenticator and each tool declares its own grant.
 */
const BE6_ROUTES: Readonly<Record<string, string>> = {
  'POST /api/v1/webhooks/stripe': 'public',
  'GET /api/v1/invoices/{id}/payment-links': 'payment:read',
  'POST /api/v1/invoices/{id}/payment-links': 'payment:create',
  'POST /api/v1/invoices/{id}/payment-links/{linkId}/deactivate': 'payment:create',
  'GET /api/v1/settings/integrations': 'settings:read',
  'PUT /api/v1/settings/integrations': 'settings:update',
  'GET /api/v1/accounts/{id}/exchange-snapshot': 'account:read',
  'POST /api/v1/mcp': 'authenticated',
  'GET /api/v1/me/api-tokens': 'authenticated',
  'POST /api/v1/me/api-tokens': 'authenticated',
  'POST /api/v1/me/api-tokens/{id}/revoke': 'authenticated',
};

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
            const grant = readRouteGrant(handler as never, controller);
            routes.push({
              route: `${RequestMethod[methodCode]} ${joinPath('api', 'v1', base, sub).replace(/:(\w+)/g, '{$1}')}`,
              grant: grant.kind,
              ...(grant.kind === 'grant'
                ? { requirement: `${grant.resource}:${grant.action}` }
                : {}),
              handler: `${controller.name}.${name}`,
            });
          }
        }
      }
    }
  }
  return routes.sort((a, b) => a.route.localeCompare(b.route));
}

function controllerOf(app: NestExpressApplication, handler: string): object {
  const name = handler.split('.')[0];
  for (const module of app.get(ModulesContainer, { strict: false }).values()) {
    for (const wrapper of module.controllers.values()) {
      const type = wrapper.metatype;
      if (type && type.name === name) return type;
    }
  }
  throw new Error(`${handler}: controller not found`);
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

  it('the @Public() set is exactly health, the Clerk and Stripe webhooks and the five portal routes (api-contract.md §5)', () => {
    const publicRoutes = inventory(app)
      .filter((r) => r.grant === 'public')
      .map((r) => r.route);
    expect(publicRoutes.sort()).toEqual(
      [
        'GET /api/v1/health',
        'POST /api/v1/webhooks/clerk',
        'POST /api/v1/webhooks/stripe',
        'GET /api/v1/portal/{token}',
        'POST /api/v1/portal/{token}/views',
        'POST /api/v1/portal/{token}/documents/{documentId}/unlock',
        'GET /api/v1/portal/{token}/documents/{documentId}',
        'GET /api/v1/portal/{token}/files/{documentId}',
      ].sort(),
    );
  });

  it('inventories exactly the BE-4 document, share-link and portal routes, each with its declared grant (C13, C24)', () => {
    const prefixes = /^(GET|POST|PUT|PATCH|DELETE) \/api\/v1\/(documents|share-links|portal)/;
    const declared = Object.fromEntries(
      inventory(app)
        .filter((r) => prefixes.test(r.route) && !(r.route in BE5_ROUTES))
        .map((r) => [r.route, r.requirement ?? r.grant]),
    );
    expect(Object.keys(BE4_ROUTES)).toHaveLength(29);
    expect(declared).toEqual(BE4_ROUTES);
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

  it('inventories exactly the 24 BE-5 intelligence routes, each with its declared grant, and no new @Public() (C13, C24)', () => {
    const routes = inventory(app);
    const declared = Object.fromEntries(
      routes.filter((r) => r.route in BE5_ROUTES).map((r) => [r.route, r.requirement ?? r.grant]),
    );
    expect(Object.keys(BE5_ROUTES)).toHaveLength(24);
    expect(declared).toEqual(BE5_ROUTES);
    // Everything under the intelligence controllers is non-public.
    const intelligence = routes.filter((r) =>
      /^(Overviews|Summaries|Shell|Dashboard|Reports|Alerts|Search|Graph|Exports)Controller\./.test(
        r.handler,
      ),
    );
    expect(intelligence.map((r) => r.grant)).not.toContain('public');
  });

  it('inventories exactly the 57 BE-3 finance routes, each with its declared grant (C8, C13, C25)', () => {
    const declared = Object.fromEntries(
      inventory(app)
        .filter((r) => r.route in FINANCE_ROUTES)
        .map((r) => [r.route, r.requirement ?? r.grant]),
    );
    expect(Object.keys(FINANCE_ROUTES)).toHaveLength(57);
    expect(declared).toEqual(FINANCE_ROUTES);
  });

  it('applies the portal and MCP throttlers to their controllers only: 70 requests to health stay 200 under a limit of 60', async () => {
    const guarded = inventory(app)
      .filter((r) => Reflect.getMetadata('__guards__', controllerOf(app, r.handler)) !== undefined)
      .map((r) => r.handler.split('.')[0]);
    expect([...new Set(guarded)].sort()).toEqual(['McpController', 'PortalController']);
    for (let i = 0; i < 70; i += 1) {
      await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    }
  });

  it('inventories exactly the 11 BE-6 routes, each with its declared grant, and no bank statements route (C13, C24)', () => {
    const routes = inventory(app);
    const declared = Object.fromEntries(
      routes.filter((r) => r.route in BE6_ROUTES).map((r) => [r.route, r.requirement ?? r.grant]),
    );
    expect(Object.keys(BE6_ROUTES)).toHaveLength(11);
    expect(declared).toEqual(BE6_ROUTES);
    expect(routes.filter((r) => /\/statements/.test(r.route))).toEqual([]);
  });

  it('GET /features is the only feature-flag route, open to any signed-in user (DT-227)', () => {
    const routes = inventory(app).filter((r) => /^[A-Z]+ \/api\/v1\/features\b/.test(r.route));
    expect(routes.map((r) => [r.route, r.requirement ?? r.grant])).toEqual([
      ['GET /api/v1/features', 'authenticated'],
    ]);
  });

  it('POST /mcp is authenticated by the MCP authenticator only and no other route is', () => {
    const marked = inventory(app)
      .filter((r) => {
        const controller = controllerOf(app, r.handler);
        return Reflect.getMetadata('usesMcpAuthenticator', controller) === true;
      })
      .map((r) => r.route);
    expect(marked).toEqual(['POST /api/v1/mcp']);
  });

  it('exposes no DELETE on finance and no finance route outside the documented set', () => {
    const financePrefixes =
      /^(GET|POST|PUT|PATCH|DELETE) \/api\/v1\/(exchange-rates|invoices|payments|allocations|installments|recurring-charges|recurring-expenses|expenses|accounts|transfers|projects\/\{id\}\/(billing|installments|recurring-charges)|clients\/\{id\}\/(billable-installments|open-invoices|credit))/;
    const finance = inventory(app)
      .map((r) => r.route)
      .filter(
        (route) => financePrefixes.test(route) && !(route in BE5_ROUTES) && !(route in BE6_ROUTES),
      );
    expect(finance.filter((route) => route.startsWith('DELETE'))).toEqual([]);
    expect(finance.sort()).toEqual(Object.keys(FINANCE_ROUTES).sort());
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

const V1 = '/api/v1';

/**
 * Route shadowing (A1, X13) over the real `AppModule` registration order, with nothing appended: a static
 * `/x/overview` must answer before the owner's `/x/:id` (which would reject `overview` as a malformed id or
 * answer 404), and `/reports/kpis` before `/reports/{slug}`.
 */
describe('route shadowing of the static intelligence routes (production AppModule order)', () => {
  const authenticator = new FakeAuthenticator();
  let app: NestExpressApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp({
      authenticator,
      probes: false,
      overrides: [{ token: AUTHORIZATION, useValue: new MatrixAuthorization() }],
    });
    const owner: CurrentUser = {
      userId: '00000000-0000-4000-8000-0000000000a1',
      clerkId: 'user_shadow_owner',
      role: 'OWNER',
      email: 'shadow-owner@example.test',
      name: 'Owner',
    };
    token = authenticator.issue(owner);
  });
  afterAll(async () => {
    await app.close();
  });

  const get = (path: string) =>
    request(app.getHttpServer()).get(`${V1}${path}`).set('Authorization', `Bearer ${token}`);

  it.each([
    'clients',
    'projects',
    'invoices',
    'payments',
    'expenses',
    'accounts',
    'documents',
    'activity',
  ])('GET /%s/overview reaches the overview handler, not /%s/:id', async (module) => {
    const res = await get(`/${module}/overview`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toBeTypeOf('object');
    // A shadowed route would answer with the id-validation or not-found envelope instead.
    expect(res.body.error).toBeUndefined();
  });

  it('GET /reports/kpis answers the 18 KPIs, not a report with slug "kpis"', async () => {
    const res = await get('/reports/kpis');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/REPORT_NOT_FOUND|NOT_FOUND/);
  });

  it('GET /reports/collected-by-month still reaches the slug route', async () => {
    const res = await get('/reports/collected-by-month');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it('GET /reports/<unknown slug> is a NOT_FOUND, so the slug is whitelisted by the use case', async () => {
    const res = await get('/reports/not-a-report');
    expect(res.status).toBe(404);
  });

  it('a normal id still reaches the owner: GET /clients/<uuid> is a 404, not an overview', async () => {
    const res = await get('/clients/00000000-0000-4000-8000-000000000001');
    expect(res.status).toBe(404);
  });
});
