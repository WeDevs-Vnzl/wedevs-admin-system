import { describe, expect, it } from 'vitest';
import {
  ARCHIVED_CLIENT,
  actor,
  KAIROS,
  NEXT_JS,
  projectRecord,
  projectWorld,
  REACT,
  RUST,
  TORNILLO,
} from '../../../../../test/commercial/projects/fakes/world';
import {
  ForbiddenError,
  NotFoundError,
  ValidationFailedError,
} from '../../../../shared/domain/domain-error';
import type { UpdateProjectInput } from './update-project.use-case';

const input = (over: Partial<UpdateProjectInput> = {}): UpdateProjectInput => ({
  id: 'pry_kairos_web',
  name: 'Sitio Kairós',
  summary: 'Sitio corporativo',
  clients: [{ clientId: KAIROS, role: 'Contratante' }],
  technologyIds: [],
  tagIds: [],
  ...over,
});

const world = () => {
  const w = projectWorld();
  w.projects.seed(projectRecord());
  w.metrics.addClient(KAIROS);
  return w;
};

const updates = (w: ReturnType<typeof world>) =>
  w.activity.entries.filter((e) => e.action === 'UPDATE');

describe('UpdateProject (mock updateProject)', () => {
  it('sanitizes the description even when the DTO is bypassed (B2)', async () => {
    const w = world();
    await expect(
      w.updateProject.execute(
        actor('OWNER'),
        input({
          description: {
            type: 'doc',
            content: [
              {
                type: 'text',
                text: 'x',
                marks: [{ type: 'link', attrs: { href: 'javascript:1' } }],
              },
            ],
          } as never,
        }),
      ),
    ).rejects.toMatchObject({ fieldErrors: { description: ['validation.invalidFormat'] } });
  });

  it('updates the fields, logs an UPDATE diff and keeps long text as "changed"', async () => {
    const w = world();
    const detail = await w.updateProject.execute(
      actor('OWNER'),
      input({
        name: 'Sitio Kairós 2',
        description: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nuevo' }] }],
        },
        startDate: '2026-02-01',
      }),
    );
    expect(detail).toMatchObject({ name: 'Sitio Kairós 2', startDate: '2026-02-01' });
    expect(updates(w)).toHaveLength(1);
    expect(updates(w)[0]).toMatchObject({
      entityLabel: 'Sitio Kairós 2',
      clientId: KAIROS,
      changes: {
        name: ['Sitio Kairós', 'Sitio Kairós 2'],
        description: 'changed',
        startDate: [null, '2026-02-01'],
      },
    });
    expect(w.searchIndex.get('PROJECT', 'pry_kairos_web')).toMatchObject({
      title: 'Sitio Kairós 2',
      body: 'Kairós C.A.\nSitio corporativo\nNuevo',
    });
  });

  it('logs nothing when nothing changed and refuses an archived or unknown project', async () => {
    const w = world();
    await w.updateProject.execute(actor('OWNER'), input());
    expect(w.activity.entries).toHaveLength(0);

    w.projects.seed(projectRecord({ id: 'pry_old', archivedAt: new Date('2026-03-01Z') }));
    for (const id of ['pry_old', 'pry_ghost']) {
      await expect(w.updateProject.execute(actor('OWNER'), input({ id }))).rejects.toBeInstanceOf(
        NotFoundError,
      );
    }
  });

  it('keeps the date a status requires: an EN_CURSO project cannot lose its start date', async () => {
    const w = projectWorld();
    w.projects.seed(projectRecord({ status: 'EN_CURSO', startDate: '2026-01-10' }));
    await expect(
      w.updateProject.execute(actor('OWNER'), input({ startDate: null })),
    ).rejects.toMatchObject({ fieldErrors: { startDate: ['validation.required'] } });

    w.projects.seed(projectRecord({ id: 'pry_done', status: 'ENTREGADO', endDate: '2026-02-01' }));
    await expect(
      w.updateProject.execute(actor('OWNER'), input({ id: 'pry_done', endDate: null })),
    ).rejects.toMatchObject({ fieldErrors: { endDate: ['validation.required'] } });
  });

  it('lets a project keep an inactive technology it already carries but not add another', async () => {
    const w = projectWorld();
    w.projects.seed(projectRecord({ technologyIds: [REACT.id] }));
    await w.updateProject.execute(actor('OWNER'), input({ technologyIds: [REACT.id, NEXT_JS.id] }));
    expect(w.projects.get('pry_kairos_web')?.technologyIds).toEqual([REACT.id, NEXT_JS.id]);

    await expect(
      w.updateProject.execute(actor('OWNER'), input({ technologyIds: [NEXT_JS.id, 'tec_ghost'] })),
    ).rejects.toBeInstanceOf(ValidationFailedError);
  });

  it('logs sorted names joined with ", " for stack and tags, never ids (CR-B4, C1)', async () => {
    const w = world();
    w.seedTag('tag_b', 'Beta');
    w.seedTag('tag_a', 'Alfa');
    await w.updateProject.execute(
      actor('OWNER'),
      input({ technologyIds: [RUST.id, NEXT_JS.id], tagIds: ['tag_b', 'tag_a'] }),
    );
    expect(updates(w)[0]?.changes).toEqual({
      technologyIds: ['', 'Next.js, Rust'],
      tagIds: ['', 'Alfa, Beta'],
    });
    await w.updateProject.execute(
      actor('OWNER'),
      input({ technologyIds: [RUST.id], tagIds: ['tag_a'] }),
    );
    expect(updates(w)[1]?.changes).toEqual({
      technologyIds: ['Next.js, Rust', 'Rust'],
      tagIds: ['Alfa, Beta', 'Alfa'],
    });
  });

  it('replaces the clients, logs the link entries and recounts old and new clients (HU-05)', async () => {
    const w = world();
    w.metrics.addClient(TORNILLO);
    await w.updateProject.execute(
      actor('OWNER'),
      input({ clients: [{ clientId: TORNILLO, role: 'Usuario final' }] }),
    );
    expect(w.activity.entries.map((e) => [e.action, e.metadata?.linkedId])).toEqual([
      ['LINK', TORNILLO],
      ['UNLINK', KAIROS],
    ]);
    expect(w.activity.entries[1]).toMatchObject({
      clientId: TORNILLO,
      touchClientIds: [TORNILLO, KAIROS],
    });
    expect(w.metrics.get(KAIROS)?.projectCount).toBe(0);
    expect(w.metrics.get(TORNILLO)?.projectCount).toBe(1);
    expect(w.searchIndex.get('PROJECT', 'pry_kairos_web')?.subtitle).toBe('Tornillo');
  });

  it('refuses an archived or unknown client and writes nothing', async () => {
    const w = world();
    await expect(
      w.updateProject.execute(actor('OWNER'), input({ clients: [{ clientId: ARCHIVED_CLIENT }] })),
    ).rejects.toMatchObject({ fieldErrors: { clients: ['projects.errors.clientNotFound'] } });
    expect(w.projects.get('pry_kairos_web')?.clients[0]?.clientId).toBe(KAIROS);
  });

  it('lets a Member update but not a Viewer (PRD §4.3)', async () => {
    const w = world();
    await expect(
      w.updateProject.execute(actor('MEMBER'), input({ summary: 'Nuevo resumen' })),
    ).resolves.toMatchObject({ summary: 'Nuevo resumen' });
    await expect(w.updateProject.execute(actor('VIEWER'), input())).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
