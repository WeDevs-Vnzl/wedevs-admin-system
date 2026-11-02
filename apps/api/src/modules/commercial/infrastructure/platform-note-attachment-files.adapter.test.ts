import { describe, expect, it } from 'vitest';
import { FileAccessRegistry } from '../../platform/application/file-access.registry';
import { ReserveFileForAttachment } from '../../platform/application/use-cases/reserve-file-for-attachment.use-case';
import { InMemoryFileRepository } from '../../../../test/files/in-memory-file.repository';
import { member, otherMember } from '../../../../test/commercial/notes/world';
import { MatrixAuthorization } from '../../identity/application/matrix-authorization';
import { PlatformNoteAttachmentFiles } from './platform-note-attachment-files.adapter';

const file = (id: string, uploadedById: string, status: 'READY' | 'PENDING' = 'READY') => ({
  id,
  storageKey: `general/2026/10/${id}`,
  bucket: 'memory',
  originalName: 'brief.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 321,
  status,
  uploadedById,
  createdAt: new Date('2026-10-30T00:00:00.000Z'),
  deletedAt: null,
});

describe('PlatformNoteAttachmentFiles', () => {
  const build = () => {
    const repo = new InMemoryFileRepository();
    const adapter = new PlatformNoteAttachmentFiles(
      new ReserveFileForAttachment(new MatrixAuthorization(), repo, new FileAccessRegistry()),
    );
    return { repo, adapter };
  };

  it('takes the file row lock and returns only the metadata a note needs', async () => {
    const { repo, adapter } = build();
    await repo.insert(file('fil_1', member.userId));
    await expect(adapter.reserve(member, 'fil_1')).resolves.toEqual({
      id: 'fil_1',
      originalName: 'brief.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 321,
    });
    expect(repo.locked).toEqual(['fil_1']);
  });

  it("answers NOT_FOUND for somebody else's unattached file, a PENDING one and an unknown one", async () => {
    const { repo, adapter } = build();
    await repo.insert(file('fil_theirs', otherMember.userId));
    await repo.insert(file('fil_pending', member.userId, 'PENDING'));
    for (const id of ['fil_theirs', 'fil_pending', 'fil_missing']) {
      await expect(adapter.reserve(member, id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
  });
});
