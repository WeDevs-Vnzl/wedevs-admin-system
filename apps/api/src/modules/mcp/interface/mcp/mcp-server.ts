import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { CurrentUser } from '../../../../shared/application/current-user';
import { callTool, type CallToolDeps } from './call-tool';
import { toolInputJsonSchema } from './tool-json-schema';

export const MCP_SERVER_INFO = { name: 'wedevs-core', version: '1.0.0' } as const;

/**
 * A fresh MCP server for one request of one user (stateless Streamable HTTP, DT-189): the tool list is the
 * registry, no more, and a call runs as `actor` through `callTool`.
 */
export function createMcpServer(deps: CallToolDeps, actor: CurrentUser): Server {
  const server = new Server(MCP_SERVER_INFO, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: deps.registry.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: toolInputJsonSchema(tool.input),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await callTool(deps, actor, request.params.name, request.params.arguments ?? {});
    return { content: [{ type: 'text' as const, text: result.text }], isError: result.isError };
  });

  return server;
}
