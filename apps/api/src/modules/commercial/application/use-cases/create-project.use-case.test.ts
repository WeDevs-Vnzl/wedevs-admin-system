import { describe, expect, it } from 'vitest';
import {
  ARCHIVED_CLIENT,
  actor,
  KAIROS,
  NEXT_JS,
  projectWorld,
  REACT,
  TORNILLO,
} from '../../../../../test/commercial/projects/fakes/world';
import { ForbiddenError, ValidationFailedError } from '../../../../shared/domain/domain-error';
import type { CreateProjectInput } from './create-project.use-case';

const input = (over: Partial<CreateProjectInput> = {}): CreateProjectInput => ({
  name: 'Sitio de prueba',
  summary: 'Un proyecto de prueba',
  status: 'PROPUESTA',
  clients: [{ clientId: KAIROS, role: 'Contratante' }],
  technologyIds: [],
  tagIds: [],
  links: [],
  ...over,
});

const fieldErrors = async (run: Promise<unknown>) => {
  try {
    await run;
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationFailedError);
    return (error as ValidationFailedError).fieldErrors;
  }
  throw new Error('expected a ValidationFailedError');
};

describe('CreateProject (mock createProject, HU-05)', () => {
  it('allocates PRY-####, defaults to PROPUESTA and logs CREATE and LINK (CA1, CA2)', async () => {
    const world = projectWorld();
    const detail = await world.createProject.execute(actor('OWNER'), input());

    expect(detail).toMatchObject({
      code: 'PRY-0001',
      status: 'PROPUESTA',
      name: 'Sitio de prueba',
      clients: [{ client: { id: KAIROS, label: 'Kairós' }, role: 'Contratante' }],
      contractedValueUsd: '0.00',
      hasBillingPlan: false,
      archivedAt: null,
    });
    const second = await world.createProject.execute(actor('OWNER'), input());
    expect(second.code).toBe('PRY-0002');

    const [create, link] = world.activity.entries;
    expect(create).toMatchObject({
      action: 'CREATE',
      entityType: 'PROJECT',
      entityId: detail.id,
      entityLabel: 'Sitio de prueba',
      clientId: KAIROS,
      touchClientIds: [KAIROS],
      metadata: { code: 'PRY-0001', status: 'PROPUESTA' },
    });
    expect(link).toMatchObject({
      action: 'LINK',
      metadata: {
        linkedType: 'CLIENT',
        linkedId: KAIROS,
        linkedLabel: 'Kairós',
        role: 'Contratante',
      },
    });
  });

  it('scopes the entry to the earliest client and touches every linked client (Q-BE2-2)', async () => {
    const world = projectWorld();
    await world.createProject.execute(
      actor('ADMIN'),
      input({ clients: [{ clientId: TORNILLO }, { clientId: KAIROS }] }),
    );
    expect(world.activity.entries[0]).toMatchObject({
      clientId: TORNILLO,
      touchClientIds: [TORNILLO, KAIROS],
    });
    expect(world.metrics.get(KAIROS)?.lastActivityAt).toEqual(world.clock.now());
  });

  it('indexes the project (code, name, client names, summary + description text) and recounts clients', async () => {
    const world = projectWorld();
    const detail = await world.createProject.execute(
      actor('OWNER'),
      input({
        clients: [{ clientId: KAIROS }, { clientId: TORNILLO }],
        description: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Detalle largo' }] }],
        },
      }),
    );
    expect(world.searchIndex.get('PROJECT', detail.id)).toMatchObject({
      code: 'PRY-0001',
      title: 'Sitio de prueba',
      subtitle: 'Kairós, Tornillo',
      body: 'Un proyecto de prueba\nDetalle largo',
      status: 'PROPUESTA',
      archived: false,
    });
    expect(world.metrics.get(KAIROS)?.projectCount).toBe(1);
    expect(world.metrics.get(TORNILLO)?.projectCount).toBe(1);
  });

  it('requires at least one existing, non-archived client (CA1)', async () => {
    const world = projectWorld();
    expect(
      await fieldErrors(world.createProject.execute(actor('OWNER'), input({ clients: [] }))),
    ).toEqual({
      clients: ['validation.required'],
    });
    for (const clientId of ['cli_ghost', ARCHIVED_CLIENT]) {
      expect(
        await fieldErrors(
          world.createProject.execute(actor('OWNER'), input({ clients: [{ clientId }] })),
        ),
      ).toEqual({ clients: ['projects.errors.clientNotFound'] });
    }
    expect(world.projects.rows).toHaveLength(0);
    expect(world.projects.writeCount).toBe(0);
  });

  it('accepts active technologies only: unknown and inactive fail on technologyIds (HU-06 CA1)', async () => {
    const world = projectWorld();
    expect(
      await fieldErrors(
        world.createProject.execute(actor('OWNER'), input({ technologyIds: ['tec_ghost'] })),
      ),
    ).toEqual({ technologyIds: ['projects.errors.technologyUnknown'] });
    expect(
      await fieldErrors(
        world.createProject.execute(actor('OWNER'), input({ technologyIds: [REACT.id] })),
      ),
    ).toEqual({ technologyIds: ['projects.errors.technologyInactive'] });

    const ok = await world.createProject.execute(
      actor('OWNER'),
      input({ technologyIds: [NEXT_JS.id] }),
    );
    expect(ok.stack).toEqual([expect.objectContaining({ id: NEXT_JS.id, name: 'Next.js' })]);
  });

  it('stores the links grouped, ordered and re-numbered per group, and refuses a non-http URL (HU-07)', async () => {
    const world = projectWorld();
    const detail = await world.createProject.execute(
      actor('OWNER'),
      input({
        links: [
          { group: 'ENTORNO', label: 'Prod', url: 'https://prod.test', order: 4 },
          { group: 'REPOSITORIO', label: 'B', url: 'https://b.test', order: 7 },
          { group: 'REPOSITORIO', label: 'A', url: 'https://a.test', order: 1 },
        ],
      }),
    );
    expect(detail.links.map((l) => [l.group, l.label, l.order])).toEqual([
      ['REPOSITORIO', 'A', 0],
      ['REPOSITORIO', 'B', 1],
      ['ENTORNO', 'Prod', 0],
    ]);

    expect(
      await fieldErrors(
        world.createProject.execute(
          actor('OWNER'),
          input({
            links: [
              { group: 'OTRO', label: 'ok', url: 'https://ok.test', order: 0 },
              { group: 'OTRO', label: 'bad', url: 'javascript:alert(1)', order: 1 },
            ],
          }),
        ),
      ),
    ).toEqual({ 'links.1.url': ['validation.invalidFormat'] });
  });

  it('assigns tags and rolls everything back on an unknown tag', async () => {
    const world = projectWorld();
    world.seedTag('tag_a', 'Urgente');
    const detail = await world.createProject.execute(actor('OWNER'), input({ tagIds: ['tag_a'] }));
    expect(detail.tags).toEqual([{ id: 'tag_a', name: 'Urgente', color: '#112233' }]);

    expect(
      await fieldErrors(
        world.createProject.execute(actor('OWNER'), input({ tagIds: ['tag_ghost'] })),
      ),
    ).toEqual({ tagIds: ['validation.invalidOption'] });
    expect(world.projects.rows).toHaveLength(1);
    // The rolled-back attempt consumed no PRY number.
    expect((await world.createProject.execute(actor('OWNER'), input())).code).toBe('PRY-0002');
  });

  it('rejects an image in the description (no project attachments)', async () => {
    const world = projectWorld();
    expect(
      await fieldErrors(
        world.createProject.execute(
          actor('OWNER'),
          input({
            description: { type: 'doc', content: [{ type: 'image', attrs: { fileId: 'f' } }] },
          }),
        ),
      ),
    ).toEqual({ description: ['validation.invalidFormat'] });
  });

  it('applies the form rules: EN_CURSO needs a start date, summary at most 280 (HU-08 CA1)', async () => {
    const world = projectWorld();
    expect(
      await fieldErrors(world.createProject.execute(actor('OWNER'), input({ status: 'EN_CURSO' }))),
    ).toEqual({ startDate: ['validation.required'] });
    expect(
      await fieldErrors(
        world.createProject.execute(actor('OWNER'), input({ summary: 'x'.repeat(281) })),
      ),
    ).toEqual({ summary: ['validation.tooLong'] });
  });

  it('grants create to Owner and Admin only: Member and Viewer are FORBIDDEN (PRD §4.3)', async () => {
    const world = projectWorld();
    for (const role of ['MEMBER', 'VIEWER'] as const) {
      await expect(world.createProject.execute(actor(role), input())).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
    await expect(world.createProject.execute(actor('ADMIN'), input())).resolves.toBeDefined();
    expect(world.projects.rows).toHaveLength(1);
  });

  it('hides the money headline from roles without canSeeFinancials (C13)', async () => {
    const world = projectWorld();
    const detail = await world.createProject.execute(actor('ADMIN'), input());
    expect(detail.contractedValueUsd).toBe('0.00');
    const asMember = await world.getProject.execute(actor('MEMBER'), detail.id);
    expect(asMember).toMatchObject({
      contractedValueUsd: null,
      invoicedUsd: null,
      collectedUsd: null,
      toInvoiceUsd: null,
    });
  });
});
