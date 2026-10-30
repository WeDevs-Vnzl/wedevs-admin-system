import { describe, expect, it } from 'vitest';
import { createWorld } from '../../../../../test/commercial/clients/world';

describe('SearchContacts', () => {
  it('returns EntityRefs of live contacts of live clients, optionally of one client', async () => {
    const w = createWorld();
    const kairos = w.seedClient({}, 0).client;
    const zafiro = w.seedClient({}, 0).client;
    const archived = w.seedClient({ deletedAt: new Date() }, 0).client;
    const ana = w.contacts.seed({
      id: 'con_ana',
      clientId: kairos.id,
      fullName: 'Ana Kairos',
      position: null,
      email: 'a@k.test',
      phone: null,
      isPrimary: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    });
    const zoe = w.contacts.seed({
      ...ana,
      id: 'con_zoe',
      clientId: zafiro.id,
      fullName: 'Zoe Zafiro',
    });
    w.contacts.seed({ ...ana, id: 'con_hidden', clientId: archived.id, fullName: 'Oculta' });
    w.contacts.seed({ ...ana, id: 'con_gone', fullName: 'Borrada', deletedAt: new Date() });

    expect(await w.searchContacts.execute(w.viewer, {})).toEqual([
      { type: 'CONTACT', id: ana.id, label: 'Ana Kairos' },
      { type: 'CONTACT', id: zoe.id, label: 'Zoe Zafiro' },
    ]);
    expect(await w.searchContacts.execute(w.viewer, { q: ' zoe ' })).toEqual([
      { type: 'CONTACT', id: zoe.id, label: 'Zoe Zafiro' },
    ]);
    expect(await w.searchContacts.execute(w.viewer, { clientId: kairos.id })).toHaveLength(1);
    expect(await w.searchContacts.execute(w.viewer, { limit: 1 })).toHaveLength(1);
    expect(await w.searchContacts.execute(w.viewer, { q: 'oculta' })).toEqual([]);
  });
});
