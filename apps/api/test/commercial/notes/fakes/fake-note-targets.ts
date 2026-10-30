import type {
  NoteTargetPort,
  ResolvedNoteTarget,
} from '../../../../src/modules/commercial/application/ports/note-target.port';
import { linkKey, type NoteLinkTarget } from '../../../../src/modules/commercial/domain/note-link';
import type { EntityRef } from '../../../../src/shared/domain/entity-ref';

/** Clients, contacts and projects a note can hang from, added by the test. */
export class FakeNoteTargets implements NoteTargetPort {
  private readonly rows = new Map<string, ResolvedNoteTarget>();

  add(type: 'CLIENT' | 'CONTACT' | 'PROJECT', id: string, label = `${type} ${id}`): EntityRef {
    const ref: EntityRef = { type, id, label };
    this.rows.set(`${type}:${id}`, { ref, archived: false });
    return ref;
  }

  archive(type: 'CLIENT' | 'CONTACT' | 'PROJECT', id: string): void {
    const row = this.rows.get(`${type}:${id}`);
    if (row) this.rows.set(`${type}:${id}`, { ...row, archived: true });
  }

  async resolve(targets: readonly NoteLinkTarget[]): Promise<Map<string, ResolvedNoteTarget>> {
    const found = new Map<string, ResolvedNoteTarget>();
    for (const target of targets) {
      const row = this.rows.get(linkKey(target));
      if (row) found.set(linkKey(target), row);
    }
    return found;
  }
}
