import { Module, type Type } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env.schema';
import { SharedInterfaceModule } from '../../shared/interface/shared-interface.module';
import { McpToolRegistry } from '../../shared/interface/mcp-tool-registry';
import { commercialTools } from '../commercial/interface/mcp/commercial.tools';
import { financeTools } from '../finance/interface/mcp/finance.tools';
import { intelligenceTools } from '../intelligence/interface/mcp/intelligence.tools';
import { McpController } from './interface/mcp/mcp.controller';
import { McpThrottlerGuard } from './interface/mcp/mcp-throttler.guard';

/**
 * The MCP server (DT-188, DT-189): `POST /mcp` over stateless Streamable HTTP, authenticated by a personal access
 * token, and the registry of tools the contexts declare in `<context>/interface/mcp/*.tools.ts`. A tool runs the
 * same use case as its HTTP route, which the feature modules do not export, so the use cases are resolved from
 * the whole container on first call. The app therefore needs the commercial, finance and intelligence modules
 * and `ApiTokensModule` (the token authenticator the `AuthGuard` looks up). Not imported by `AppModule` before
 * package 4.1, which aggregates it in `mcp.module.ts`.
 */
@Module({
  imports: [
    SharedInterfaceModule,
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        throttlers: [{ ttl: config.THROTTLE_TTL * 1000, limit: config.THROTTLE_LIMIT }],
      }),
    }),
  ],
  controllers: [McpController],
  providers: [
    McpThrottlerGuard,
    {
      provide: McpToolRegistry,
      useFactory: (moduleRef: ModuleRef) => {
        const resolve = <T>(token: Type<T>): T => moduleRef.get(token, { strict: false });
        const registry = new McpToolRegistry();
        for (const tool of [
          ...intelligenceTools(resolve),
          ...commercialTools(resolve),
          ...financeTools(resolve),
        ]) {
          registry.register(tool);
        }
        return registry;
      },
      inject: [ModuleRef],
    },
  ],
  exports: [McpToolRegistry],
})
export class McpServerModule {}
