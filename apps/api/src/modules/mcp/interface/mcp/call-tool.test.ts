import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { FakeAuthorization } from '../../../../../test/support/fakes/fake-authorization';
import type { CurrentUser } from '../../../../shared/application/current-user';
import { ConflictError } from '../../../../shared/domain/domain-error';
import {
  McpToolRegistry,
  type McpToolDefinition,
} from '../../../../shared/interface/mcp-tool-registry';
import { callTool } from './call-tool';

const USER: CurrentUser = {
  userId: 'usr_1',
  clerkId: 'clerk_1',
  role: 'MEMBER',
  email: 'm@example.test',
  name: 'M',
};

function setup(overrides: Partial<McpToolDefinition> = {}, policy?: () => boolean) {
  const handler = vi.fn((_actor: CurrentUser, input: unknown) =>
    Promise.resolve({ echoed: input }),
  );
  const registry = new McpToolRegistry();
  registry.register({
    name: 'get_thing',
    description: 'd',
    input: z.object({ id: z.string().min(1), limit: z.coerce.number().int().default(5) }),
    grant: { resource: 'client', action: 'read' },
    handler,
    ...overrides,
  });
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const authorization = new FakeAuthorization(policy ? { policy } : {});
  const call = (name: string, args: unknown) =>
    callTool({ registry, authorization, logger }, USER, name, args);
  return { handler, call, logger };
}

interface Body {
  echoed?: unknown;
  error: { code: string; message: string; fieldErrors: Record<string, string[]> | null };
}
const body = (result: { text: string }) => JSON.parse(result.text) as Body;

describe('callTool', () => {
  it('runs the handler as the token user with the parsed arguments and returns its output as JSON', async () => {
    const { call, handler } = setup();
    const result = await call('get_thing', { id: 'abc', limit: '7' });
    expect(result.isError).toBe(false);
    expect(body(result)).toEqual({ echoed: { id: 'abc', limit: 7 } });
    expect(handler).toHaveBeenCalledWith(USER, { id: 'abc', limit: 7 });
  });

  it('refuses FORBIDDEN without the declared grant and never calls the handler', async () => {
    const { call, handler } = setup({}, () => false);
    const result = await call('get_thing', { id: 'abc' });
    expect(result.isError).toBe(true);
    expect(body(result).error.code).toBe('FORBIDDEN');
    expect(handler).not.toHaveBeenCalled();
  });

  it('checks the declared resource and action', async () => {
    const seen: unknown[] = [];
    const { call } = setup({}, ((_u: unknown, action: unknown, resource: unknown) => {
      seen.push([action, resource]);
      return true;
    }) as never);
    await call('get_thing', { id: 'abc' });
    expect(seen).toEqual([['read', 'client']]);
  });

  it('skips the grant check for an authenticated tool and leaves it to the use case', async () => {
    const { call, handler } = setup(
      { grant: 'authenticated' as unknown as McpToolDefinition['grant'] },
      () => false,
    );
    const result = await call('get_thing', { id: 'abc' });
    expect(result.isError).toBe(false);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('answers VALIDATION with field errors for invalid arguments and never calls the handler', async () => {
    const { call, handler } = setup();
    const result = await call('get_thing', { id: '' });
    expect(result.isError).toBe(true);
    expect(body(result).error.code).toBe('VALIDATION');
    expect(body(result).error.fieldErrors).toHaveProperty('id');
    expect(handler).not.toHaveBeenCalled();
  });

  it('answers NOT_FOUND for an unknown tool', async () => {
    const { call } = setup();
    const result = await call('nope', {});
    expect(result.isError).toBe(true);
    expect(body(result).error.code).toBe('NOT_FOUND');
  });

  it('maps a DomainError to its code, key and entity', async () => {
    const { call } = setup({
      handler: () => Promise.reject(new ConflictError({ message: 'client.errors.duplicate' })),
    });
    const result = await call('get_thing', { id: 'abc' });
    expect(body(result).error).toMatchObject({
      code: 'CONFLICT',
      message: 'client.errors.duplicate',
    });
  });

  it('maps an unexpected error to INTERNAL without leaking its message, and logs it', async () => {
    const { call, logger } = setup({ handler: () => Promise.reject(new Error('secret detail')) });
    const result = await call('get_thing', { id: 'abc' });
    expect(body(result).error.code).toBe('INTERNAL');
    expect(result.text).not.toContain('secret detail');
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
