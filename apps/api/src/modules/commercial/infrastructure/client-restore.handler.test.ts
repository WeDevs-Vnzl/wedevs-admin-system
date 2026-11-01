import { describe, expect, it } from 'vitest';
import { createWorld, nth, rejection } from '../../../../test/commercial/clients/world';
import { ClientRestoreHandler } from './client-restore.handler';
import { ContactRestoreHandler } from './contact-restore.handler';

describe('restore handlers', () => {
  it('restore a client through its own use case and answer its EntityRef', async () => {
    const w = createWorld();
    const { client } = w.seedClient({
      code: 'CLI-0005',
      tradeName: 'Kairos Studio',
      deletedAt: new Date(),
    });
    const handler = new ClientRestoreHandler(w.restoreClient);
    expect([handler.entityType, handler.resource]).toEqual(['CLIENT', 'client']);
    expect(await handler.restore(w.owner, client.id)).toEqual({
      type: 'CLIENT',
      id: client.id,
      code: 'CLI-0005',
      label: 'Kairos Studio',
    });
    expect(w.clients.get(client.id)?.deletedAt).toBeNull();
  });

  it('report a tax id conflict with the trash key and the holder', async () => {
    const w = createWorld();
    const { client } = w.seedClient({ taxId: 'J-30123456-7', deletedAt: new Date() });
    const holder = w.seedClient({ taxId: 'J-30123456-7' }).client;
    const error = await rejection(
      new ClientRestoreHandler(w.restoreClient).restore(w.owner, client.id),
    );
    expect(error).toMatchObject({
      code: 'CONFLICT',
      message: 'trash.errors.taxIdTaken',
      entity: { id: holder.id },
    });
  });

  it('restore a contact and refuse it while its client is archived', async () => {
    const w = createWorld();
    const live = w.seedClient({}, 1);
    await w.archiveContact.execute(w.owner, { id: nth(live.contacts, 0).id });
    const handler = new ContactRestoreHandler(w.restoreContact);
    expect([handler.entityType, handler.resource]).toEqual(['CONTACT', 'contact']);
    expect(await handler.restore(w.owner, nth(live.contacts, 0).id)).toMatchObject({
      type: 'CONTACT',
      id: nth(live.contacts, 0).id,
    });

    const gone = w.seedClient({ deletedAt: new Date() }, 1);
    w.contacts.seed({ ...nth(gone.contacts, 0), deletedAt: new Date() });
    const error = await rejection(handler.restore(w.owner, nth(gone.contacts, 0).id));
    expect(error).toMatchObject({ code: 'CONFLICT', message: 'trash.errors.clientArchived' });
  });
});
