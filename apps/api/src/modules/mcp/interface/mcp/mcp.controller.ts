import { Controller, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import type { AuthorizationPort } from '../../../../shared/application/ports/authorization.port';
import { AUTHORIZATION } from '../../../../shared/application/ports/tokens';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { McpAuthenticated } from '../../../../shared/interface/auth.guard';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { APP_LOGGER, type AppLogger } from '../../../../shared/interface/logger';
import { McpToolRegistry } from '../../../../shared/interface/mcp-tool-registry';
import { createMcpServer } from './mcp-server';
import { McpThrottlerGuard } from './mcp-throttler.guard';

/**
 * The MCP endpoint (DT-189): stateless Streamable HTTP, one server and one transport per request, answered as
 * plain JSON. Authenticated by a personal access token only (`@McpAuthenticated()`, DT-190); each tool call
 * checks its declared grant and runs the same use case as its HTTP route as the token's user (A8).
 */
@ApiTags('mcp')
@Controller('mcp')
@McpAuthenticated()
@UseGuards(McpThrottlerGuard)
export class McpController {
  constructor(
    @Inject(McpToolRegistry) private readonly registry: McpToolRegistry,
    @Inject(AUTHORIZATION) private readonly authorization: AuthorizationPort,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
  ) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    operationId: 'mcp',
    summary: 'MCP over Streamable HTTP (JSON-RPC 2.0); personal access token only',
  })
  @ApiBody({ schema: { type: 'object' }, description: 'A JSON-RPC 2.0 request or batch' })
  @ApiOkResponse({ schema: { type: 'object' }, description: 'The JSON-RPC 2.0 response' })
  @ApiErrorResponses('UNAUTHENTICATED', 'RATE_LIMITED', 'INTERNAL')
  async handle(
    @CurrentUser() user: CurrentUserModel,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const server = createMcpServer(
      { registry: this.registry, authorization: this.authorization, logger: this.logger },
      user,
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }
}
