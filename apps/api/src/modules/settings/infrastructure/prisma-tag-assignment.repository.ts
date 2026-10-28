import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../shared/infrastructure/prisma/generated-client';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type { TagAssignmentRepository } from '../application/ports/tag-assignment.repository.port';
import {
  compareTagsForChips,
  targetKey,
  type Tag,
  type TagTarget,
  type TaggableEntityType,
} from '../domain/tag';
import { TARGET_COLUMN } from './prisma-tag.repository';

const where = (target: TagTarget): Prisma.TagAssignmentWhereInput => ({
  [TARGET_COLUMN[target.entityType]]: target.entityId,
});

/**
 * `TagAssignment` rows. Writes require the caller's unit of work; `tag_one_target` guarantees one
 * target column per row and the `(tagId, <target>)` uniques keep a pair single.
 */
@Injectable()
export class PrismaTagAssignmentRepository implements TagAssignmentRepository {
  constructor(private readonly host: TransactionHost) {}

  async tagIdsFor(target: TagTarget): Promise<string[]> {
    const rows = await this.host.db.tagAssignment.findMany({
      where: where(target),
      select: { tagId: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => row.tagId);
  }

  async tagsFor(targets: readonly TagTarget[]): Promise<Map<string, Tag[]>> {
    const result = new Map<string, Tag[]>(targets.map((t) => [targetKey(t), []]));
    const byType = new Map<TaggableEntityType, string[]>();
    for (const target of targets) {
      byType.set(target.entityType, [...(byType.get(target.entityType) ?? []), target.entityId]);
    }
    for (const [entityType, ids] of byType) {
      const column = TARGET_COLUMN[entityType] as 'clientId';
      const rows = await this.host.db.tagAssignment.findMany({
        where: { [column]: { in: ids } },
        include: { tag: true },
      });
      for (const row of rows) {
        const entityId = row[column];
        if (entityId === null) continue;
        result.get(targetKey({ entityType, entityId }))?.push(row.tag);
      }
    }
    for (const tags of result.values()) tags.sort(compareTagsForChips);
    return result;
  }

  async add(target: TagTarget, tagIds: readonly string[]): Promise<void> {
    const tx = this.host.requireTransaction('TagAssignmentRepository.add');
    if (tagIds.length === 0) return;
    await tx.tagAssignment.createMany({
      data: tagIds.map((tagId) => ({
        tagId,
        [TARGET_COLUMN[target.entityType]]: target.entityId,
      })),
      skipDuplicates: true,
    });
  }

  async remove(target: TagTarget, tagIds: readonly string[]): Promise<void> {
    const tx = this.host.requireTransaction('TagAssignmentRepository.remove');
    if (tagIds.length === 0) return;
    await tx.tagAssignment.deleteMany({ where: { ...where(target), tagId: { in: [...tagIds] } } });
  }
}
