import { describe, expect, it } from 'vitest';
import { NoteLinkTargetRegistry, type NoteLinkTargetResolver } from './note-link-target.registry';
import type { NoteTargetPort, ResolvedNoteTarget } from './ports/note-target.port';
import { linkKey, type NoteLinkTarget } from '../domain/note-link';

const ref = (type: 'CLIENT' | 'INVOICE', id: string) => ({ type, id, label: `${type} ${id}` });

class FakeOwnTargets implements NoteTargetPort {
  readonly calls: NoteLinkTarget[][] = [];
  constructor(private readonly rows: Record<string, ResolvedNoteTarget>) {}
  async resolve(targets: readonly NoteLinkTarget[]) {
    this.calls.push([...targets]);
    const found = new Map<string, ResolvedNoteTarget>();
    for (const t of targets) {
      const row = this.rows[linkKey(t)];
      if (row) found.set(linkKey(t), row);
    }
    return found;
  }
}

const invoices: NoteLinkTargetResolver = {
  entityType: 'INVOICE',
  async resolve(ids) {
    return new Map(
      ids
        .filter((id) => id.startsWith('inv_'))
        .map((id) => [id, { ref: ref('INVOICE', id), archived: id === 'inv_old' }]),
    );
  },
};

const build = () => {
  const own = new FakeOwnTargets({
    'CLIENT:cli_1': { ref: ref('CLIENT', 'cli_1'), archived: false },
    'CLIENT:cli_old': { ref: ref('CLIENT', 'cli_old'), archived: true },
  });
  return { own, registry: new NoteLinkTargetRegistry(own) };
};
const at = (i: number) => `links.${i}.entityType`;

describe('NoteLinkTargetRegistry', () => {
  it('resolves commercial types through the own port and registered types through their resolver', async () => {
    const { registry } = build();
    registry.register(invoices);
    const refs = await registry.requireLive(
      [
        { entityType: 'CLIENT', entityId: 'cli_1' },
        { entityType: 'INVOICE', entityId: 'inv_1' },
      ],
      at,
    );
    expect(refs.map((r) => r.id)).toEqual(['cli_1', 'inv_1']);
  });

  it('answers VALIDATION on the field for a type nobody registered', async () => {
    const { registry } = build();
    await expect(
      registry.requireLive(
        [
          { entityType: 'CLIENT', entityId: 'cli_1' },
          { entityType: 'DOCUMENT', entityId: 'doc_1' },
        ],
        at,
      ),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { 'links.1.entityType': ['validation.invalidOption'] },
    });
  });

  it('answers NOT_FOUND for an unknown or archived record', async () => {
    const { registry } = build();
    registry.register(invoices);
    for (const target of [
      { entityType: 'CLIENT', entityId: 'cli_missing' },
      { entityType: 'CLIENT', entityId: 'cli_old' },
      { entityType: 'INVOICE', entityId: 'inv_old' },
      { entityType: 'INVOICE', entityId: 'nope' },
    ] as const) {
      await expect(registry.requireLive([target], at)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    }
  });

  it('resolves archived records for display and skips unregistered types', async () => {
    const { registry } = build();
    const found = await registry.resolve([
      { entityType: 'CLIENT', entityId: 'cli_old' },
      { entityType: 'PAYMENT', entityId: 'pay_1' },
    ]);
    expect([...found.keys()]).toEqual(['CLIENT:cli_old']);
    expect(found.get('CLIENT:cli_old')?.archived).toBe(true);
  });

  it('refuses to override a type the commercial context owns', () => {
    const { registry } = build();
    expect(() =>
      registry.register({ entityType: 'CLIENT', resolve: async () => new Map() }),
    ).toThrow(/commercial context/);
  });

  it('does not call the own port when no target is commercial', async () => {
    const { registry, own } = build();
    registry.register(invoices);
    await registry.resolve([{ entityType: 'INVOICE', entityId: 'inv_1' }]);
    expect(own.calls).toHaveLength(0);
  });
});
