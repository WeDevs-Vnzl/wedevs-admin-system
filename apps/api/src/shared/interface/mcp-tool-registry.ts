import type { ZodType } from 'zod';
import type { PermissionAction, PermissionResource } from '../application/authorization';
import type { CurrentUser } from '../application/current-user';

/**
 * SDK-free registry of MCP tools (A1, DT-195). Each context declares its tools in
 * `<context>/interface/mcp/*.tools.ts`; the MCP server adapter (the only importer of
 * `@modelcontextprotocol/sdk`) reads them from here. A tool declares the grant of its HTTP route, which the
 * server checks before the handler; the use case behind the handler still runs `can()`.
 */
export interface McpToolDefinition {
  /** `snake_case`, unique across the registry. */
  readonly name: string;
  readonly description: string;
  /** Validates and types the tool arguments; enforces their limits (lesson B2 lives in the use case too). */
  readonly input: ZodType;
  readonly grant: { readonly resource: PermissionResource; readonly action: PermissionAction };
  /** Calls the same use case as the HTTP route, as the token's user, and returns its output DTO. */
  readonly handler: (actor: CurrentUser, input: unknown) => Promise<unknown>;
}

const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;

export class McpToolRegistry {
  private readonly tools = new Map<string, McpToolDefinition>();

  /** Throws on an invalid or duplicate name: a wiring mistake that must fail the boot. */
  register(tool: McpToolDefinition): void {
    if (!TOOL_NAME.test(tool.name)) {
      throw new Error(
        `Invalid MCP tool name: ${JSON.stringify(tool.name)} (tool name must be snake_case)`,
      );
    }
    if (this.tools.has(tool.name)) {
      throw new Error(`MCP tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): McpToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): McpToolDefinition[] {
    return [...this.tools.values()];
  }
}
