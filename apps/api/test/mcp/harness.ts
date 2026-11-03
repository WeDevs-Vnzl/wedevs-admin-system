import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { ApiTokenRoutesModule } from '../../src/modules/mcp/api-token-routes.module';
import { McpServerModule } from '../../src/modules/mcp/mcp-server.module';
import { MatrixAuthorization } from '../../src/modules/identity/application/matrix-authorization';
import type {
  PermissionAction,
  PermissionOptions,
  PermissionResource,
} from '../../src/shared/application/authorization';
import type { CurrentUser } from '../../src/shared/application/current-user';
import type { AuthorizationPort } from '../../src/shared/application/ports/authorization.port';
import { AUTHORIZATION } from '../../src/shared/application/ports/tokens';
import type { UserRole } from '../../src/shared/domain/enums';
import { createTestPrisma, truncateBusinessTables } from '../support/db';
import { FakeAuthenticator } from '../support/fakes/fake-authenticator';
import { createTestApp } from '../support/test-app';
import type { AppConfig } from '../../src/config/env.schema';
import { APP_CONFIG } from '../../src/config/config.module';

export const V1 = '/api/v1';
export const ROLES = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const;

/** The real PRD matrix, with a switch that denies every grant to prove a tool is refused before its use case. */
export class SwitchableAuthorization implements AuthorizationPort {
  denyAll = false;
  private readonly matrix = new MatrixAuthorization();
  can(
    user: CurrentUser,
    action: PermissionAction,
    resource: PermissionResource,
    opts?: PermissionOptions,
  ): boolean {
    return !this.denyAll && this.matrix.can(user, action, resource, opts);
  }
  canSeeFinancials(user: CurrentUser): boolean {
    return this.matrix.canSeeFinancials(user);
  }
}

export interface McpWorld {
  readonly app: NestExpressApplication;
  readonly prisma: ReturnType<typeof createTestPrisma>;
  readonly authorization: SwitchableAuthorization;
  readonly clerk: FakeAuthenticator;
  readonly mcpUrl: URL;
  /** Clerk session of each role (for the HTTP routes). */
  readonly sessions: Record<UserRole, string>;
  /** Personal access token secret of each role (for `/mcp`). */
  readonly secrets: Record<UserRole, string>;
  readonly users: Record<UserRole, CurrentUser>;
}

export async function startMcpApp(config?: AppConfig) {
  const clerk = new FakeAuthenticator();
  const authorization = new SwitchableAuthorization();
  const app = await createTestApp({
    authenticator: clerk,
    probes: false,
    modules: [ApiTokenRoutesModule, McpServerModule],
    overrides: [
      { token: AUTHORIZATION, useValue: authorization },
      ...(config ? [{ token: APP_CONFIG, useValue: config }] : []),
    ],
  });
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, clerk, authorization, mcpUrl: new URL(`http://127.0.0.1:${port}${V1}/mcp`) };
}

/** Fresh users, one per role, a Clerk session and a personal access token for each. */
export async function seedWorld(
  base: Awaited<ReturnType<typeof startMcpApp>>,
  prisma: ReturnType<typeof createTestPrisma>,
): Promise<McpWorld> {
  await truncateBusinessTables(prisma);
  const sessions = {} as Record<UserRole, string>;
  const secrets = {} as Record<UserRole, string>;
  const users = {} as Record<UserRole, CurrentUser>;
  for (const role of ROLES) {
    const row = await prisma.user.create({
      data: {
        clerkId: `user_mcp_${role.toLowerCase()}`,
        email: `mcp-${role.toLowerCase()}@example.test`,
        name: role,
        role,
      },
    });
    users[role] = { userId: row.id, clerkId: row.clerkId, role, email: row.email, name: row.name };
    sessions[role] = base.clerk.issue(users[role]);
    const issued = await request(base.app.getHttpServer())
      .post(`${V1}/me/api-tokens`)
      .set('Authorization', `Bearer ${sessions[role]}`)
      .send({ name: `mcp-${role}` })
      .expect(201);
    secrets[role] = (issued.body as { secret: string }).secret;
  }
  base.authorization.denyAll = false;
  return { ...base, prisma, sessions, secrets, users };
}

/** A parsed JSON value of a tool body (shape asserted by each test). */
export type Json = ReturnType<typeof JSON.parse>;

export interface ToolOutcome {
  readonly isError: boolean;
  readonly body: Json;
}

/** An in-process MCP client (the SDK's own) against the booted app, authenticated by `secret`. */
export async function connect(world: Pick<McpWorld, 'mcpUrl'>, secret: string) {
  const client = new Client({ name: 'e2e', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(world.mcpUrl, {
    requestInit: { headers: { Authorization: `Bearer ${secret}` } },
  });
  await client.connect(transport);
  return {
    client,
    async call(name: string, args: Record<string, unknown> = {}): Promise<ToolOutcome> {
      const result = await client.callTool({ name, arguments: args });
      const content = result.content as { type: string; text: string }[];
      return { isError: result.isError === true, body: JSON.parse(content[0]?.text ?? 'null') };
    },
    close: () => client.close(),
  };
}
