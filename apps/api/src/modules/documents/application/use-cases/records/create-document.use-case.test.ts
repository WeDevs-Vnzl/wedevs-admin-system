import { describe, expect, it } from 'vitest';
import {
  ANA,
  EXPENSE_1,
  INVOICE_1,
  KAIROS,
  KAIROS_ALT,
  KAIROS_WEB,
  PAYMENT_1,
  SOLARIS,
  admin,
  member,
  newDocument,
  owner,
  seededWorld,
  viewer,
} from '../../../../../../test/documents/records/world';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationFailedError,
} from '../../../../../shared/domain/domain-error';

// Behavioral spec: `createDocument` of fe/src/mocks/services/documents.ts and the matching cases of
// documents.test.ts / documents-lifecycle.test.ts, plus the BE rules (DT-136, DT-141, DT-142).

const rejection = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
};

describe('CreateDocument', () => {
  it('creates a BORRADOR with the next DOC code, links, search entry and client-scoped activity', async () => {
    const world = seededWorld();
    const doc = await world.createDocument.execute(
      member,
      newDocument({
        summary: '  Acuerdo de confidencialidad ',
        effectiveDate: '2026-10-01',
        expiresAt: '2027-10-01',
        links: [KAIROS, KAIROS_WEB, KAIROS_ALT, ANA],
      }),
    );

    expect(doc).toMatchObject({
      code: 'DOC-0001',
      title: 'NDA con Kairos',
      status: 'BORRADOR',
      summary: 'Acuerdo de confidencialidad',
      effectiveDate: '2026-10-01',
      expiresAt: '2027-10-01',
      signedAt: null,
      alertDaysBefore: 30,
      currentVersion: null,
      versionCount: 0,
      draftContent: null,
      isShared: false,
      archivedAt: null,
      createdBy: { id: member.userId },
      type: { id: 'dtyp_nda', requiresSignature: true, hasExpiration: true },
      category: { id: 'dcat_legal', name: 'Legal' },
    });
    expect(doc.links.map((l) => l.entity)).toEqual([
      { type: 'CLIENT', id: 'cli_kairos', label: 'Kairos' },
      { type: 'PROJECT', id: 'pry_kairos_web', label: 'Kairos Web' },
      { type: 'PROJECT', id: 'pry_kairos_app', label: 'Kairos App' },
      { type: 'CONTACT', id: 'con_ana', label: 'Ana' },
    ]);
    expect(world.uow.lastOptions).toEqual({ isolation: 'Serializable' });

    const entries = world.activity.entries;
    expect(entries.map((e) => e.action)).toEqual(['CREATE', 'LINK', 'LINK', 'LINK', 'LINK']);
    expect(entries[0]).toMatchObject({
      actor: { actorType: 'USER', userId: member.userId },
      entityType: 'DOCUMENT',
      entityId: doc.id,
      entityLabel: 'NDA con Kairos',
      clientId: 'cli_kairos',
      touchClientIds: ['cli_kairos'],
    });
    expect(entries[1]?.metadata).toEqual({ entityType: 'CLIENT', entityId: 'cli_kairos' });
    expect(entries[2]?.metadata).toEqual({ entityType: 'PROJECT', entityId: 'pry_kairos_web' });

    expect(world.search.get('DOCUMENT', doc.id)).toEqual({
      entityType: 'DOCUMENT',
      entityId: doc.id,
      code: 'DOC-0001',
      title: 'NDA con Kairos',
      subtitle: 'NDA',
      body: 'Acuerdo de confidencialidad',
      status: 'BORRADOR',
      archived: false,
    });
  });

  it('derives the client scope from the clients of a project link when no client is linked', async () => {
    const world = seededWorld();
    await world.createDocument.execute(
      owner,
      newDocument({ links: [KAIROS_WEB, SOLARIS], typeId: 'dtyp_nota' }),
    );
    expect(world.activity.entries[0]).toMatchObject({
      clientId: 'cli_kairos',
      touchClientIds: ['cli_kairos', 'cli_solaris'],
    });
  });

  it('records no client scope for a document linked to a contact only', async () => {
    const world = seededWorld();
    await world.createDocument.execute(owner, newDocument({ links: [ANA], typeId: 'dtyp_nota' }));
    expect(world.activity.entries[0]?.clientId).toBeUndefined();
  });

  it('links invoices, payments and expenses for the roles that can read them', async () => {
    const world = seededWorld();
    const doc = await world.createDocument.execute(
      admin,
      newDocument({ links: [KAIROS, INVOICE_1, PAYMENT_1, EXPENSE_1] }),
    );
    expect(doc.links.map((l) => l.entity.type)).toEqual([
      'CLIENT',
      'INVOICE',
      'PAYMENT',
      'EXPENSE',
    ]);
  });

  it('allocates consecutive DOC codes', async () => {
    const world = seededWorld();
    const a = await world.createDocument.execute(owner, newDocument());
    const b = await world.createDocument.execute(owner, newDocument({ title: 'Otro' }));
    expect([a.code, b.code]).toEqual(['DOC-0001', 'DOC-0002']);
  });

  it('assigns the tags in the same unit of work', async () => {
    const world = seededWorld();
    world.seedTag('tag_urgente', 'Urgente');
    const doc = await world.createDocument.execute(owner, newDocument({ tagIds: ['tag_urgente'] }));
    expect(doc.tags).toEqual([{ id: 'tag_urgente', name: 'Urgente', color: '#112233' }]);
    await expect(
      world.createDocument.execute(owner, newDocument({ tagIds: ['tag_missing'] })),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { tagIds: ['validation.invalidOption'] },
    });
  });

  it('refuses a Viewer with FORBIDDEN and writes nothing', async () => {
    const world = seededWorld();
    await expect(world.createDocument.execute(viewer, newDocument())).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(world.documents.writeCount).toBe(0);
    expect(world.activity.entries).toHaveLength(0);
  });

  describe('type rules, enforced without the DTO', () => {
    it('a signature date needs a type with signature', async () => {
      const world = seededWorld();
      const error = await rejection(
        world.createDocument.execute(
          owner,
          newDocument({ typeId: 'dtyp_nota', signedAt: '2026-10-08' }),
        ),
      );
      expect(error).toBeInstanceOf(ValidationFailedError);
      expect((error as ValidationFailedError).fieldErrors).toEqual({
        signedAt: ['documents.validation.signedAtNotAllowed'],
      });
    });

    it('an expiry date needs a type with expiration', async () => {
      const world = seededWorld();
      await expect(
        world.createDocument.execute(
          owner,
          newDocument({ typeId: 'dtyp_nota', expiresAt: '2027-01-01' }),
        ),
      ).rejects.toMatchObject({
        code: 'VALIDATION',
        fieldErrors: { expiresAt: ['documents.validation.expiresAtNotAllowed'] },
      });
    });

    it('accepts a signature date and an expiry on a type that has both', async () => {
      const world = seededWorld();
      const doc = await world.createDocument.execute(
        owner,
        newDocument({ signedAt: '2026-10-08', expiresAt: '2027-01-01' }),
      );
      expect(doc).toMatchObject({ signedAt: '2026-10-08', expiresAt: '2027-01-01' });
    });

    it('an expiry before the effective date is refused', async () => {
      const world = seededWorld();
      await expect(
        world.createDocument.execute(
          owner,
          newDocument({ effectiveDate: '2026-10-10', expiresAt: '2026-10-01' }),
        ),
      ).rejects.toMatchObject({
        code: 'VALIDATION',
        fieldErrors: { expiresAt: ['validation.date.invalid'] },
      });
    });

    it('refuses an inactive type (VALIDATION on typeId) and an unknown one (NOT_FOUND)', async () => {
      const world = seededWorld();
      await expect(
        world.createDocument.execute(owner, newDocument({ typeId: 'dtyp_propuesta' })),
      ).rejects.toMatchObject({
        code: 'VALIDATION',
        fieldErrors: { typeId: ['validation.invalidOption'] },
      });
      await expect(
        world.createDocument.execute(owner, newDocument({ typeId: 'dtyp_missing' })),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('a blank title is refused', async () => {
      const world = seededWorld();
      await expect(
        world.createDocument.execute(owner, newDocument({ title: '   ' })),
      ).rejects.toMatchObject({
        code: 'VALIDATION',
        fieldErrors: { title: ['validation.required'] },
      });
    });
  });

  describe('link targets', () => {
    it('refuses a record that does not exist or is archived, leaving nothing behind', async () => {
      const world = seededWorld();
      await expect(
        world.createDocument.execute(
          owner,
          newDocument({ links: [KAIROS, { entityType: 'CLIENT', entityId: 'cli_missing' }] }),
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
      world.noteTargets.archive('CLIENT', 'cli_solaris');
      await expect(
        world.createDocument.execute(owner, newDocument({ links: [SOLARIS] })),
      ).rejects.toBeInstanceOf(NotFoundError);

      expect(world.documents.rows).toHaveLength(0);
      expect(world.activity.entries).toHaveLength(0);
      expect(world.search.size).toBe(0);
      // The rolled-back code was not consumed.
      const doc = await world.createDocument.execute(owner, newDocument());
      expect(doc.code).toBe('DOC-0001');
    });

    it('refuses a repeated target and DOCUMENT as a target', async () => {
      const world = seededWorld();
      await expect(
        world.createDocument.execute(owner, newDocument({ links: [KAIROS, KAIROS] })),
      ).rejects.toMatchObject({
        code: 'VALIDATION',
        fieldErrors: { links: ['validation.invalidOption'] },
      });
      await expect(
        world.createDocument.execute(
          owner,
          newDocument({ links: [{ entityType: 'DOCUMENT', entityId: 'doc_1' }] }),
        ),
      ).rejects.toMatchObject({
        code: 'VALIDATION',
        fieldErrors: { 'links.0.entityType': ['validation.invalidOption'] },
      });
    });

    it('answers NOT_FOUND for a financial record the caller cannot read (DT-142)', async () => {
      const world = seededWorld();
      await expect(
        world.createDocument.execute(member, newDocument({ links: [INVOICE_1] })),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(world.documents.rows).toHaveLength(0);
    });

    it('accepts at most 30 links', async () => {
      const world = seededWorld();
      const many = Array.from({ length: 31 }, (_, i) => ({
        entityType: 'CLIENT' as const,
        entityId: `cli_${i}`,
      }));
      await expect(
        world.createDocument.execute(owner, newDocument({ links: many })),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
    });
  });

  describe('the optional first version (all or nothing)', () => {
    it('creates the document with its READY file as version 1 and logs CREATE, LINK, UPLOAD', async () => {
      const world = seededWorld();
      world.seedFile('fil_nda', member);
      const doc = await world.createDocument.execute(
        member,
        newDocument({
          initialVersion: { format: 'ARCHIVO', fileId: 'fil_nda', changelog: 'Firmado' },
        }),
      );
      expect(doc.currentVersion).toMatchObject({
        versionNumber: 1,
        format: 'ARCHIVO',
        changelog: 'Firmado',
        isCurrent: true,
        file: { id: 'fil_nda', originalName: 'fil_nda.pdf', mimeType: 'application/pdf' },
      });
      expect(doc.versionCount).toBe(1);
      expect(world.activity.entries.map((e) => e.action)).toEqual(['CREATE', 'LINK', 'UPLOAD']);
      expect(world.activity.entries[2]?.metadata).toEqual({ versionNumber: 1, format: 'ARCHIVO' });
      expect(world.fileRepo.locked).toEqual(['fil_nda']);
    });

    it('logs VERSION_PUBLISH for a link version and keeps the URL trimmed', async () => {
      const world = seededWorld();
      const doc = await world.createDocument.execute(
        owner,
        newDocument({
          typeId: 'dtyp_enlace',
          initialVersion: { format: 'ENLACE', url: ' https://example.com/spec ' },
        }),
      );
      expect(doc.currentVersion).toMatchObject({
        format: 'ENLACE',
        url: 'https://example.com/spec',
      });
      expect(world.activity.entries.at(-1)).toMatchObject({
        action: 'VERSION_PUBLISH',
        metadata: { versionNumber: 1, format: 'ENLACE' },
      });
    });

    it('leaves nothing behind when the file is not usable (unknown, not READY, or held by a version)', async () => {
      const world = seededWorld();
      world.seedFile('fil_pending', member, 'PENDING');
      for (const fileId of ['fil_missing', 'fil_pending']) {
        await expect(
          world.createDocument.execute(
            member,
            newDocument({ initialVersion: { format: 'ARCHIVO', fileId } }),
          ),
        ).rejects.toBeInstanceOf(NotFoundError);
      }
      world.seedFile('fil_used', member);
      await world.createDocument.execute(
        member,
        newDocument({ initialVersion: { format: 'ARCHIVO', fileId: 'fil_used' } }),
      );
      const before = world.documents.rows.length;
      await expect(
        world.createDocument.execute(
          member,
          newDocument({
            title: 'Segundo',
            initialVersion: { format: 'ARCHIVO', fileId: 'fil_used' },
          }),
        ),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(world.documents.rows).toHaveLength(before);
      expect(before).toBe(1);
    });

    it('refuses a URL that is not http(s) without the DTO', async () => {
      const world = seededWorld();
      for (const url of ['javascript:alert(1)', 'data:text/html,x', 'ftp://example.com', 'nope']) {
        await expect(
          world.createDocument.execute(
            owner,
            newDocument({ initialVersion: { format: 'ENLACE', url } }),
          ),
        ).rejects.toMatchObject({
          code: 'VALIDATION',
          fieldErrors: { url: ['validation.invalidFormat'] },
        });
      }
      expect(world.documents.rows).toHaveLength(0);
    });

    it('creates markdown documents with no version', async () => {
      const world = seededWorld();
      const doc = await world.createDocument.execute(owner, newDocument({ typeId: 'dtyp_nota' }));
      expect(doc).toMatchObject({ currentVersion: null, versionCount: 0 });
      expect(world.search.get('DOCUMENT', doc.id)?.body).toBeNull();
    });
  });
});
