import type { CurrentUser } from '../../../../shared/application/current-user';
import type { AuthorizationPort } from '../../../../shared/application/ports/authorization.port';
import { ForbiddenError, NotFoundError, ValidationFailedError } from '../../../../shared/domain';
import { zodFieldErrors } from '../../../../shared/interface/common.schemas';
import { mapException } from '../../../../shared/interface/http-error.filter';
import type { AppLogger } from '../../../../shared/interface/logger';
import type { McpToolRegistry } from '../../../../shared/interface/mcp-tool-registry';

/** SDK-free outcome of one tool call: the text of the single content block and whether it is an error. */
export interface ToolCallResult {
  readonly isError: boolean;
  readonly text: string;
}

export interface CallToolDeps {
  readonly registry: McpToolRegistry;
  readonly authorization: AuthorizationPort;
  readonly logger: AppLogger;
}

/** An `@Authenticated()` route has no route grant; its use case decides by data (DT-79, DT-195). */
const AUTHENTICATED = 'authenticated';

function failure(error: unknown, logger: AppLogger, tool: string): ToolCallResult {
  const mapped = mapException(error);
  if (mapped.code === 'INTERNAL') {
    // The message and arguments are never logged: they may carry customer data.
    logger.error({ err: error, tool }, 'MCP tool failed');
  }
  return {
    isError: true,
    text: JSON.stringify({
      error: {
        code: mapped.code,
        message: mapped.message,
        fieldErrors: mapped.fieldErrors,
        entity: mapped.entity,
      },
    }),
  };
}

/**
 * Runs one MCP tool as the token's user (A8, DT-195): the declared grant is checked first, then the arguments
 * are validated with the route's input schema, then the same use case as the HTTP route runs (and checks
 * `can()` again). Errors leave as the `api-contract.md` §4 codes and i18n keys, never as prose.
 */
export async function callTool(
  deps: CallToolDeps,
  actor: CurrentUser,
  name: string,
  args: unknown,
): Promise<ToolCallResult> {
  const tool = deps.registry.get(name);
  if (!tool) return failure(new NotFoundError(), deps.logger, name);

  if (tool.grant !== AUTHENTICATED) {
    const { resource, action } = tool.grant;
    if (!deps.authorization.can(actor, action, resource)) {
      return failure(new ForbiddenError(), deps.logger, name);
    }
  }

  const parsed = tool.input.safeParse(args ?? {});
  if (!parsed.success) {
    return failure(
      new ValidationFailedError({ fieldErrors: zodFieldErrors(parsed.error) }),
      deps.logger,
      name,
    );
  }

  try {
    const output = await tool.handler(actor, parsed.data);
    return { isError: false, text: JSON.stringify(output ?? null) };
  } catch (error) {
    return failure(error, deps.logger, name);
  }
}
