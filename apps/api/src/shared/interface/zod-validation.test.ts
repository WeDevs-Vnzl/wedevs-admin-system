import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ZodValidationException, createZodDto } from 'nestjs-zod';
import { AppZodValidationPipe, genericIssueMessage } from './zod-validation';

const msg = (schema: z.ZodType, input: unknown) =>
  schema.safeParse(input).error?.issues.map((issue) => issue.message);

describe('global Zod error map', () => {
  it('maps built-in issues to validation.* keys, never prose', () => {
    expect(msg(z.string(), undefined)).toEqual(['validation.required']);
    expect(msg(z.string(), null)).toEqual(['validation.required']);
    expect(msg(z.string(), 5)).toEqual(['validation.invalidFormat']);
    expect(msg(z.string().min(1), '')).toEqual(['validation.required']);
    expect(msg(z.string().min(3), 'a')).toEqual(['validation.tooShort']);
    expect(msg(z.string().max(2), 'abc')).toEqual(['validation.tooLong']);
    expect(msg(z.number().min(5), 1)).toEqual(['validation.tooSmall']);
    expect(msg(z.number().max(5), 9)).toEqual(['validation.tooLarge']);
    expect(msg(z.number().nonnegative(), -1)).toEqual(['validation.nonNegative']);
    expect(msg(z.number().positive(), 0)).toEqual(['validation.positive']);
    expect(msg(z.enum(['A']), 'B')).toEqual(['validation.invalidOption']);
    expect(msg(z.enum(['A']), undefined)).toEqual(['validation.required']);
    expect(msg(z.email(), 'x')).toEqual(['validation.invalidEmail']);
    expect(msg(z.string().regex(/^a$/), 'b')).toEqual(['validation.invalidFormat']);
  });

  it('keeps custom messages', () => {
    expect(msg(z.string().min(3, 'validation.custom'), 'a')).toEqual(['validation.custom']);
  });

  it('falls back to invalidFormat for other issue codes', () => {
    expect(
      genericIssueMessage({ code: 'unrecognized_keys', keys: ['x'], input: {} } as never),
    ).toBe('validation.invalidFormat');
  });
});

describe('AppZodValidationPipe', () => {
  class Dto extends createZodDto(z.object({ name: z.string().min(1) })) {}

  it('returns the parsed value for valid input', () => {
    const pipe = new AppZodValidationPipe();
    expect(pipe.transform({ name: 'a' }, { type: 'body', metatype: Dto })).toEqual({ name: 'a' });
  });

  it('throws ZodValidationException on invalid input', () => {
    const pipe = new AppZodValidationPipe();
    expect(() => pipe.transform({}, { type: 'body', metatype: Dto })).toThrow(
      ZodValidationException,
    );
  });

  it('passes through parameters without a DTO', () => {
    const pipe = new AppZodValidationPipe();
    expect(pipe.transform('abc', { type: 'param', metatype: String })).toBe('abc');
  });
});
