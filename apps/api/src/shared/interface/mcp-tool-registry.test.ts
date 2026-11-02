import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { CurrentUser } from '../application/current-user';
import { McpToolRegistry, type McpToolDefinition } from './mcp-tool-registry';

const user: CurrentUser = {
  userId: 'u1',
  clerkId: 'clerk_1',
  role: 'OWNER',
  email: 'owner@example.test',
  name: 'Owner',
};

const tool = (overrides: Partial<McpToolDefinition> = {}): McpToolDefinition => ({
  name: 'clients_list',
  description: 'List clients',
  input: z.object({ limit: z.number().int().optional() }),
  grant: { resource: 'client', action: 'read' },
  handler: async (_actor, input) => ({ received: input }),
  ...overrides,
});

describe('McpToolRegistry', () => {
  it('registers a tool and returns it by name', () => {
    const registry = new McpToolRegistry();
    const definition = tool();
    registry.register(definition);
    expect(registry.get('clients_list')).toBe(definition);
  });

  it('lists tools in registration order', () => {
    const registry = new McpToolRegistry();
    registry.register(tool({ name: 'b_tool' }));
    registry.register(tool({ name: 'a_tool' }));
    expect(registry.list().map((item) => item.name)).toEqual(['b_tool', 'a_tool']);
  });

  it('throws on a duplicate name and keeps the first tool', () => {
    const registry = new McpToolRegistry();
    const first = tool();
    registry.register(first);
    expect(() => registry.register(tool({ description: 'Other' }))).toThrow(/clients_list/);
    expect(registry.get('clients_list')).toBe(first);
    expect(registry.list()).toHaveLength(1);
  });

  it.each(['', 'Has Space', 'UPPER', '1leading', 'a'.repeat(65), 'dash-name'])(
    'rejects the tool name %j',
    (name) => {
      expect(() => new McpToolRegistry().register(tool({ name }))).toThrow(/tool name/);
    },
  );

  it('returns undefined for an unknown tool', () => {
    expect(new McpToolRegistry().get('missing')).toBeUndefined();
  });

  it('runs the handler with the actor and the input', async () => {
    const registry = new McpToolRegistry();
    registry.register(tool());
    const found = registry.get('clients_list');
    await expect(found?.handler(user, { limit: 5 })).resolves.toEqual({ received: { limit: 5 } });
  });
});
