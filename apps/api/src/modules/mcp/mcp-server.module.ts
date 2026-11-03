import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
  type Type,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
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
export class McpServerModule implements NestModule {
  /**
   * The server is stateless (contract choice 1): no GET stream and no session to DELETE. A middleware answers
   * 405 with `Allow: POST`, so the route inventory and the OpenAPI document keep `POST /mcp` as the only route.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply((_req: Request, res: Response, _next: NextFunction) => {
        res.setHeader('Allow', 'POST');
        res.status(405).end();
      })
      .forRoutes(
        { path: 'mcp', method: RequestMethod.GET, version: '1' },
        { path: 'mcp', method: RequestMethod.DELETE, version: '1' },
      );
  }
}
