import { describe, expect, it } from 'vitest';
import {
  actor,
  projectRecord,
  projectWorld,
} from '../../../../../test/commercial/projects/fakes/world';
import { PROJECT_STATUS_VALUES } from '../../../../shared/domain/enums';
import { ForbiddenError, NotFoundError } from '../../../../shared/domain/domain-error';
import { PROJECT_STATUS_TRANSITIONS } from '../../domain/project-status';
import type { ProjectStatus } from '../../../../shared/domain/enums';
import type { SetProjectStatusInput } from './set-project-status.use-case';

const ID = 'pry_kairos_web';
const input = (over: Partial<SetProjectStatusInput> & { status: ProjectStatus }) => ({
  id: ID,
  cancelPendingInstallments: false,
  finishRecurringCharges: false,
  confirm: false,
  ...over,
});

function world(status: ProjectStatus = 'PROPUESTA', over = {}) {
  const w = projectWorld();
  w.projects.seed(projectRecord({ status, ...over }));
  return w;
}

describe('SetProjectStatus (mock setProjectStatus, HU-08)', () => {
  it('allows exactly the transitions of PROJECT_STATUS_TRANSITIONS', async () => {
    for (const from of PROJECT_STATUS_VALUES) {
      for (const to of PROJECT_STATUS_VALUES) {
        const w = world(from, { startDate: '2026-01-01', endDate: '2026-02-01' });
        const run = w.setProjectStatus.execute(
          actor('OWNER'),
          input({ status: to, confirm: true }),
        );
        if (PROJECT_STATUS_TRANSITIONS[from].includes(to)) {
          await expect(run).resolves.toMatchObject({ project: { status: to } });
        } else {
          await expect(run).rejects.toMatchObject({
            fieldErrors: { status: ['projects.errors.invalidTransition'] },
          });
          expect(w.projects.writeCount).toBe(0);
        }
      }
    }
  });

  it('requires a start date for EN_CURSO and an end date for ENTREGADO (CA1, CA2)', async () => {
    const w = world('PROPUESTA');
    await expect(
      w.setProjectStatus.execute(actor('OWNER'), input({ status: 'EN_CURSO' })),
    ).rejects.toMatchObject({ fieldErrors: { startDate: ['validation.required'] } });
    await expect(
      w.setProjectStatus.execute(
        actor('OWNER'),
        input({ status: 'EN_CURSO', startDate: '2026-02-01' }),
      ),
    ).resolves.toMatchObject({ project: { status: 'EN_CURSO', startDate: '2026-02-01' } });

    await expect(
      w.setProjectStatus.execute(actor('OWNER'), input({ status: 'ENTREGADO' })),
    ).rejects.toMatchObject({ fieldErrors: { endDate: ['validation.required'] } });
    await expect(
      w.setProjectStatus.execute(
        actor('OWNER'),
        input({ status: 'ENTREGADO', endDate: '2026-01-15' }),
      ),
    ).rejects.toMatchObject({ fieldErrors: { endDate: ['validation.date.invalid'] } });
    await expect(
      w.setProjectStatus.execute(
        actor('OWNER'),
        input({ status: 'ENTREGADO', endDate: '2026-03-01' }),
      ),
    ).resolves.toMatchObject({ project: { status: 'ENTREGADO', endDate: '2026-03-01' } });
  });

  it('uses the dates already on the project when the request carries none', async () => {
    const w = world('PROPUESTA', { startDate: '2026-02-01' });
    await expect(
      w.setProjectStatus.execute(actor('OWNER'), input({ status: 'EN_CURSO' })),
    ).resolves.toMatchObject({ project: { startDate: '2026-02-01' } });
  });

  it('logs STATUS_CHANGE with [before, after] and the dates it set (CA4)', async () => {
    const w = world('PROPUESTA');
    await w.setProjectStatus.execute(
      actor('MEMBER'),
      input({ status: 'EN_CURSO', startDate: '2026-02-01' }),
    );
    expect(w.activity.entries).toHaveLength(1);
    expect(w.activity.entries[0]).toMatchObject({
      action: 'STATUS_CHANGE',
      entityType: 'PROJECT',
      entityId: ID,
      changes: { status: ['PROPUESTA', 'EN_CURSO'], startDate: [null, '2026-02-01'] },
    });
    expect(w.activity.entries[0]?.metadata).toBeUndefined();
    expect(w.searchIndex.get('PROJECT', ID)?.status).toBe('EN_CURSO');
  });

  it('hints EN_CURSO without a billing plan and MANTENIMIENTO without an active recurring charge', async () => {
    const w = world('PROPUESTA');
    const started = await w.setProjectStatus.execute(
      actor('OWNER'),
      input({ status: 'EN_CURSO', startDate: '2026-02-01' }),
    );
    expect(started.hints).toEqual(['NO_BILLING_PLAN']);

    w.billing.plans.add(ID);
    const w2 = world('PROPUESTA');
    w2.billing.plans.add(ID);
    const withPlan = await w2.setProjectStatus.execute(
      actor('OWNER'),
      input({ status: 'EN_CURSO', startDate: '2026-02-01' }),
    );
    expect(withPlan.hints).toEqual([]);

    const w3 = world('ENTREGADO', { endDate: '2026-02-01' });
    const maintained = await w3.setProjectStatus.execute(
      actor('OWNER'),
      input({ status: 'MANTENIMIENTO' }),
    );
    expect(maintained.hints).toEqual(['SUGGEST_RECURRING_CHARGE']);
    const w4 = world('ENTREGADO', { endDate: '2026-02-01' });
    w4.billing.recurring.add(ID);
    expect(
      (await w4.setProjectStatus.execute(actor('OWNER'), input({ status: 'MANTENIMIENTO' }))).hints,
    ).toEqual([]);
  });

  it('CANCELADO needs confirm; the chosen options go to the billing port and are recorded (CA3, Q-BE2-1)', async () => {
    const w = world('EN_CURSO', { startDate: '2026-01-01' });
    await expect(
      w.setProjectStatus.execute(actor('OWNER'), input({ status: 'CANCELADO' })),
    ).rejects.toMatchObject({ fieldErrors: { confirm: ['validation.required'] } });
    expect(w.billing.cancelCalls).toHaveLength(0);

    w.billing.cancelResult = { installments: 2, recurringCharges: 1 };
    const result = await w.setProjectStatus.execute(
      actor('OWNER'),
      input({
        status: 'CANCELADO',
        confirm: true,
        cancelPendingInstallments: true,
        finishRecurringCharges: false,
      }),
    );
    expect(result.project.status).toBe('CANCELADO');
    expect(w.billing.cancelCalls).toEqual([
      {
        projectId: ID,
        options: { cancelPendingInstallments: true, finishRecurringCharges: false },
      },
    ]);
    expect(w.activity.entries[0]).toMatchObject({
      action: 'STATUS_CHANGE',
      changes: { status: ['EN_CURSO', 'CANCELADO'] },
      metadata: { cancelledInstallments: 2, finishedRecurringCharges: 1 },
    });
  });

  it('does not call the billing port for other statuses', async () => {
    const w = world('PROPUESTA');
    await w.setProjectStatus.execute(
      actor('OWNER'),
      input({ status: 'EN_CURSO', startDate: '2026-02-01' }),
    );
    expect(w.billing.cancelCalls).toHaveLength(0);
  });

  it('opens a Serializable unit of work only when cancelling (Q-BE3-1)', async () => {
    const cancelling = world('EN_CURSO', { startDate: '2026-01-01' });
    await cancelling.setProjectStatus.execute(
      actor('OWNER'),
      input({ status: 'CANCELADO', confirm: true }),
    );
    expect(cancelling.uow.lastOptions).toEqual({ isolation: 'Serializable' });

    const other = world('PROPUESTA');
    await other.setProjectStatus.execute(
      actor('OWNER'),
      input({ status: 'EN_CURSO', startDate: '2026-02-01' }),
    );
    expect(other.uow.lastOptions?.isolation).not.toBe('Serializable');
  });

  it('refuses a Viewer, an archived project and an unknown one', async () => {
    const w = world('PROPUESTA');
    await expect(
      w.setProjectStatus.execute(actor('VIEWER'), input({ status: 'CANCELADO', confirm: true })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    w.projects.seed(projectRecord({ id: 'pry_old', archivedAt: new Date('2026-03-01Z') }));
    for (const id of ['pry_old', 'pry_ghost']) {
      await expect(
        w.setProjectStatus.execute(
          actor('OWNER'),
          input({ id, status: 'CANCELADO', confirm: true }),
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    }
  });
});
