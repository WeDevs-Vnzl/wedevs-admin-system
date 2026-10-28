import { describe, expect, it } from 'vitest';
import type { CurrentUser } from '../../../../shared/application/current-user';
import type {
  ActivityEntry,
  ActivityLogPort,
} from '../../../../shared/application/ports/activity-log.port';
import { FakeAuthorization } from '../../../../../test/support/fakes/fake-authorization';
import { InMemoryActivityLog } from '../../../../../test/support/fakes/in-memory-activity-log';
import { InMemoryUnitOfWork } from '../../../../../test/support/fakes/in-memory-unit-of-work';
import { InMemorySettingRepository } from '../../../../../test/settings/fakes/in-memory-setting.repository';
import { FakeCompanyLogo } from '../../../../../test/settings/fakes/fake-company-logo';
import { ForbiddenError, ValidationFailedError } from '../../../../shared/domain/domain-error';
import type { UserRole } from '../../../../shared/domain/enums';
import { UpdateCompanySettings } from './update-company-settings.use-case';

const actor = (role: UserRole): CurrentUser => ({
  userId: `usr_${role.toLowerCase()}`,
  clerkId: `user_${role.toLowerCase()}`,
  role,
  email: `${role.toLowerCase()}@example.test`,
  name: role,
});

/** Matrix stand-in: only Owner and Admin hold `update` on `settings` (PRD §4.3). */
const settingsPolicy = new FakeAuthorization({
  policy: (user, action, resource) =>
    action === 'update' && resource === 'settings' && ['OWNER', 'ADMIN'].includes(user.role),
});

const input = {
  name: 'WeDevs Studio',
  legalName: 'WeDevs Studio, C.A.',
  taxId: 'J-12345678-9',
  address: 'Calle Demo 1, Caracas',
};

function setup(options: { activityLog?: ActivityLogPort } = {}) {
  const uow = new InMemoryUnitOfWork();
  const settings = new InMemorySettingRepository(uow);
  const activity = new InMemoryActivityLog(uow);
  const logos = new FakeCompanyLogo();
  const useCase = new UpdateCompanySettings(
    settingsPolicy,
    uow,
    settings,
    options.activityLog ?? activity,
    logos,
  );
  return { settings, activity, logos, useCase };
}

describe('UpdateCompanySettings', () => {
  it('stores the profile and logs one SETTINGS_CHANGE for an Owner', async () => {
    const { settings, activity, useCase } = setup();
    const saved = await useCase.execute(actor('OWNER'), { ...input, logoFileId: null });
    expect(saved).toEqual({ ...input, logoFileId: null });
    expect(settings.rows.get('company')).toEqual(saved);
    expect(activity.entries).toHaveLength(1);
    expect(activity.entries[0]).toEqual<ActivityEntry>({
      actor: { actorType: 'USER', userId: 'usr_owner' },
      action: 'SETTINGS_CHANGE',
      entityType: 'SETTING',
      entityId: 'company',
      entityLabel: 'WeDevs Studio',
      changes: {
        name: ['', 'WeDevs Studio'],
        legalName: [null, 'WeDevs Studio, C.A.'],
        taxId: [null, 'J-12345678-9'],
        address: [null, 'Calle Demo 1, Caracas'],
      },
    });
  });

  it('allows Admin as well (settings grant of PRD §4.3)', async () => {
    const { useCase } = setup();
    await expect(useCase.execute(actor('ADMIN'), input)).resolves.toMatchObject({
      name: 'WeDevs Studio',
    });
  });

  it('refuses Member and Viewer with FORBIDDEN and writes nothing', async () => {
    for (const role of ['MEMBER', 'VIEWER'] as const) {
      const { settings, activity, useCase } = setup();
      await expect(useCase.execute(actor(role), input)).rejects.toBeInstanceOf(ForbiddenError);
      expect(settings.saveCount).toBe(0);
      expect(settings.rows.has('company')).toBe(false);
      expect(activity.entries).toHaveLength(0);
    }
  });

  it('checks authorization before anything else (a forbidden caller learns nothing about the logo)', async () => {
    const { logos, useCase } = setup();
    await expect(
      useCase.execute(actor('MEMBER'), { ...input, logoFileId: 'fil_unknown' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(logos.calls).toBe(0);
  });

  it('logs nothing and writes nothing when the profile did not change', async () => {
    const { settings, activity, useCase } = setup();
    await useCase.execute(actor('OWNER'), input);
    expect(activity.entries).toHaveLength(1);
    const writes = settings.saveCount;

    await useCase.execute(actor('OWNER'), { ...input, legalName: '  WeDevs Studio, C.A.  ' });
    expect(activity.entries).toHaveLength(1);
    expect(settings.saveCount).toBe(writes);
  });

  it('refuses a logo that is not a ready file with VALIDATION and keeps the profile', async () => {
    const { settings, activity, useCase } = setup();
    await expect(
      useCase.execute(actor('OWNER'), { ...input, logoFileId: 'fil_missing' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { logoFileId: ['validation.id.invalid'] },
    });
    expect(settings.rows.has('company')).toBe(false);
    expect(activity.entries).toHaveLength(0);
  });

  it('accepts a logo the CompanyLogoPort reports as ready', async () => {
    const { logos, useCase } = setup();
    logos.markReady('fil_logo');
    await expect(
      useCase.execute(actor('OWNER'), { ...input, logoFileId: 'fil_logo' }),
    ).resolves.toMatchObject({ logoFileId: 'fil_logo' });
  });

  it('rejects invalid input before reading the logo port or the store', async () => {
    const { settings, logos, useCase } = setup();
    const error = await useCase
      .execute(actor('OWNER'), { ...input, name: '   ' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationFailedError);
    expect((error as ValidationFailedError).fieldErrors).toEqual({ name: ['validation.required'] });
    expect(logos.calls).toBe(0);
    expect(settings.saveCount).toBe(0);
  });

  it('rolls the write back when the activity entry cannot be recorded', async () => {
    const failingLog: ActivityLogPort = {
      record: () => Promise.reject(new Error('activity store down')),
    };
    const { settings, useCase } = setup({ activityLog: failingLog });
    await expect(useCase.execute(actor('OWNER'), input)).rejects.toThrow('activity store down');
    expect(settings.rows.has('company')).toBe(false);
  });

  it('passes the real caller to the logo port', async () => {
    const { logos, useCase } = setup();
    logos.markReady('fil_logo');
    await useCase.execute(actor('ADMIN'), { ...input, logoFileId: 'fil_logo' });
    expect(logos.lastActor?.userId).toBe('usr_admin');
  });

  it('lets the current logo be set again without asking the port, and still refuses a swap the port rejects', async () => {
    const { logos, useCase } = setup();
    logos.markReady('fil_logo');
    await useCase.execute(actor('OWNER'), { ...input, logoFileId: 'fil_logo' });
    const asked = logos.calls;

    await expect(
      useCase.execute(actor('OWNER'), { ...input, logoFileId: 'fil_logo', name: 'Renamed' }),
    ).resolves.toMatchObject({ logoFileId: 'fil_logo', name: 'Renamed' });
    expect(logos.calls).toBe(asked);

    await expect(
      useCase.execute(actor('OWNER'), { ...input, logoFileId: 'fil_other' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
