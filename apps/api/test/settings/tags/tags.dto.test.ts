import { describe, expect, it } from 'vitest';
import {
  TAGGABLE_ENTITY_TYPE_VALUES,
  TAG_COLOR_PATTERN,
  TAG_NAME_MAX_LENGTH,
} from '../../../src/modules/settings/domain/tag';
import {
  TAGGABLE_ENTITY_TYPES,
  TAG_COLOR_REGEX,
  TAG_NAME_MAX,
  assignTagsSchema,
  createTagSchema,
  unassignTagSchema,
} from '../../../src/modules/settings/interface/http/dto/tags.dto';

describe('tags DTOs', () => {
  it('repeats the domain bounds exactly', () => {
    expect([...TAGGABLE_ENTITY_TYPES]).toEqual([...TAGGABLE_ENTITY_TYPE_VALUES]);
    expect(TAG_NAME_MAX).toBe(TAG_NAME_MAX_LENGTH);
    expect(TAG_COLOR_REGEX.source).toBe(TAG_COLOR_PATTERN.source);
  });

  it('createTag trims the name and enforces the colour shape (FE validators/tags.test cases)', () => {
    expect(createTagSchema.parse({ name: '  Nuevo ', color: '#1A2b3C' })).toEqual({
      name: 'Nuevo',
      color: '#1A2b3C',
    });
    for (const color of ['1A2B3C', '#123', '#GGGGGG', 'red']) {
      expect(createTagSchema.safeParse({ name: 'x', color }).success, color).toBe(false);
    }
    expect(createTagSchema.safeParse({ name: '   ', color: '#000000' }).success).toBe(false);
    expect(createTagSchema.safeParse({ name: 'a'.repeat(41), color: '#000000' }).success).toBe(
      false,
    );
  });

  it('assignTags needs 1 to 50 distinct valid ids and a known entity type', () => {
    const base = { entityType: 'CLIENT', entityId: 'cli_1' };
    expect(assignTagsSchema.safeParse({ ...base, tagIds: ['a'] }).success).toBe(true);
    expect(assignTagsSchema.safeParse({ ...base, tagIds: [] }).success).toBe(false);
    expect(assignTagsSchema.safeParse({ ...base, tagIds: ['a', 'a'] }).success).toBe(false);
    expect(
      assignTagsSchema.safeParse({
        ...base,
        tagIds: Array.from({ length: 51 }, (_, i) => `t${i}`),
      }).success,
    ).toBe(false);
    expect(assignTagsSchema.safeParse({ ...base, entityType: 'TAG', tagIds: ['a'] }).success).toBe(
      false,
    );
    expect(unassignTagSchema.safeParse({ ...base, tagId: 't1' }).success).toBe(true);
    expect(unassignTagSchema.safeParse({ ...base, tagId: '' }).success).toBe(false);
  });
});
