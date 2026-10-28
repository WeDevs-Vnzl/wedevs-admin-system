import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { ApiErrorResponses } from './api-error-responses';
import { ErrorResponse } from './error-envelope';
import { ERROR_STATUS } from './http-error.filter';

class Probe {
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'VALIDATION', 'INTERNAL')
  many(): void {}

  @ApiErrorResponses('CONFLICT', 'INTEGRITY_LOCK', 'RATE_LIMITED')
  shared(): void {}
}

const responses = (name: keyof Probe) =>
  Reflect.getMetadata('swagger/apiResponse', Probe.prototype[name]) as Record<
    string,
    { description: string; type: unknown }
  >;

describe('@ApiErrorResponses', () => {
  it('emits the api-contract §4 status of each code with the ErrorResponse schema', () => {
    const meta = responses('many');
    expect(Object.keys(meta).sort()).toEqual(['401', '403', '404', '422', '500']);
    expect(ERROR_STATUS.UNAUTHENTICATED).toBe(401);
    for (const entry of Object.values(meta)) expect(entry.type).toBe(ErrorResponse);
  });

  it('merges codes that share a status into one response naming all of them', () => {
    const meta = responses('shared');
    expect(Object.keys(meta).sort()).toEqual(['409', '429']);
    expect(meta['409']?.description).toContain('CONFLICT');
    expect(meta['409']?.description).toContain('INTEGRITY_LOCK');
    expect(meta['429']?.description).toContain('RATE_LIMITED');
  });
});
