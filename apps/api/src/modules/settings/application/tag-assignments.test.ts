import { describe, expect, it } from 'vitest';
import { createWorld, userOf } from '../../../../test/settings/tags/world';

const client = { entityType: 'CLIENT', entityId: 'cli_1' } as const;
const actor = userOf('ADMIN');

describe('TagAssignments', () => {
  describe('replace', () => {
    it('sets the exact tag set and returns the ids before and after', async () => {
      const w = createWorld();
      w.seedTag('t_a', 'A');
      w.seedTag('t_b', 'B');
      w.seedTag('t_c', 'C');
      await w.uow.run(() => w.assignments.replace(actor, client, ['t_a', 't_b']));
      const result = await w.uow.run(() => w.assignments.replace(actor, client, ['t_b', 't_c']));
      expect(result).toEqual({ before: ['t_a', 't_b'], after: ['t_b', 't_c'] });
      expect(w.assignmentRepo.committedIds(client).sort()).toEqual(['t_b', 't_c']);
    });

    it('clears the target with an empty list', async () => {
      const w = createWorld();
      w.seedTag('t_a', 'A');
      await w.uow.run(() => w.assignments.replace(actor, client, ['t_a']));
      const result = await w.uow.run(() => w.assignments.replace(actor, client, []));
      expect(result).toEqual({ before: ['t_a'], after: [] });
    });

    it('ignores repeated ids', async () => {
      const w = createWorld();
      w.seedTag('t_a', 'A');
      const result = await w.uow.run(() => w.assignments.replace(actor, client, ['t_a', 't_a']));
      expect(result.after).toEqual(['t_a']);
    });

    it('rejects an unknown tag id with VALIDATION on tagIds and writes nothing', async () => {
      const w = createWorld();
      w.seedTag('t_a', 'A');
      await expect(
        w.uow.run(() => w.assignments.replace(actor, client, ['t_a', 'tag_missing'])),
      ).rejects.toMatchObject({
        code: 'VALIDATION',
        fieldErrors: { tagIds: ['validation.invalidOption'] },
      });
      expect(w.assignmentRepo.committedIds(client)).toEqual([]);
    });

    it('is a programming error outside the caller unit of work', async () => {
      const w = createWorld();
      w.seedTag('t_a', 'A');
      await expect(w.assignments.replace(actor, client, ['t_a'])).rejects.toThrow(
        /only valid inside UnitOfWorkPort.run/,
      );
    });
  });

  describe('add and remove', () => {
    it('adds only what is missing and returns the full chip order', async () => {
      const w = createWorld();
      w.seedTag('t_a', 'A', '#000001', '2026-01-01T00:00:00.000Z');
      w.seedTag('t_b', 'B', '#000002', '2026-01-02T00:00:00.000Z');
      await w.uow.run(() => w.assignments.add(client, ['t_b']));
      const result = await w.uow.run(() => w.assignments.add(client, ['t_a', 't_b']));
      expect(result.added.map((t) => t.id)).toEqual(['t_a']);
      expect(result.all.map((t) => t.id)).toEqual(['t_a', 't_b']);
    });

    it('removes an assigned tag and reports a missing one as null', async () => {
      const w = createWorld();
      w.seedTag('t_a', 'A');
      w.seedTag('t_b', 'B');
      await w.uow.run(() => w.assignments.add(client, ['t_a', 't_b']));
      const removed = await w.uow.run(() => w.assignments.remove(client, 't_a'));
      expect(removed.removed?.id).toBe('t_a');
      expect(removed.all.map((t) => t.id)).toEqual(['t_b']);
      const again = await w.uow.run(() => w.assignments.remove(client, 't_a'));
      expect(again.removed).toBeNull();
    });
  });

  describe('chipsFor', () => {
    it('returns chips per target, an empty list for an untagged one', async () => {
      const w = createWorld();
      w.seedTag('t_a', 'A', '#0000AA');
      await w.uow.run(() => w.assignments.add(client, ['t_a']));
      const chips = await w.assignments.chipsFor([
        client,
        { entityType: 'PROJECT', entityId: 'pry_1' },
      ]);
      expect(chips.get('CLIENT:cli_1')).toEqual([{ id: 't_a', name: 'A', color: '#0000AA' }]);
      expect(chips.get('PROJECT:pry_1')).toEqual([]);
    });
  });
});
