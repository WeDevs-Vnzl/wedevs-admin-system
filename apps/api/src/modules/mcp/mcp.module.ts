import { Module } from '@nestjs/common';
import { ApiTokensModule } from '../identity/api-tokens.module';
import { ApiTokenRoutesModule } from './api-token-routes.module';
import { McpServerModule } from './mcp-server.module';

/**
 * Aggregator of the MCP context for `AppModule` (package 4.1): `POST /mcp`, its tool registry, the personal
 * access token routes and the `MCP_AUTHENTICATOR` the `AuthGuard` looks up (DT-189, DT-190).
 */
@Module({ imports: [ApiTokensModule, ApiTokenRoutesModule, McpServerModule] })
export class McpModule {}
