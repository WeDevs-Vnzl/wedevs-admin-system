import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import type { ErrorCode } from '../domain';
import { ErrorResponse } from './error-envelope';
import { ERROR_STATUS } from './http-error.filter';

/**
 * Documents the error responses of a route: each code maps to its `api-contract.md` §4 status with the
 * `ErrorResponse` schema. Codes sharing a status are merged into one response naming all of them.
 */
export function ApiErrorResponses(...codes: ErrorCode[]): MethodDecorator & ClassDecorator {
  const byStatus = new Map<number, ErrorCode[]>();
  for (const code of codes) {
    const status = ERROR_STATUS[code];
    byStatus.set(status, [...(byStatus.get(status) ?? []), code]);
  }
  return applyDecorators(
    ...[...byStatus].map(([status, group]) =>
      ApiResponse({ status, description: group.join(' | '), type: ErrorResponse }),
    ),
  );
}
