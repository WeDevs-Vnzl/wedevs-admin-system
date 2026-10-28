import { describe, expect, it } from 'vitest';
import type { CurrentUser } from '../../../../shared/application/current-user';
import type { UserRole } from '../../../../shared/domain/enums';
import { InMemorySettingRepository } from '../../../../../test/settings/fakes/in-memory-setting.repository';
import { InMemoryUnitOfWork } from '../../../../../test/support/fakes/in-memory-unit-of-work';
import { GetCompanySettings } from './get-company-settings.use-case';

const actor = (role: UserRole): CurrentUser => ({
  userId: `usr_${role.toLowerCase()}`,
  clerkId: `user_${role.toLowerCase()}`,
  role,
  email: `${role.toLowerCase()}@example.test`,
  name: role,
});

function setup() {
  const uow = new InMemoryUnitOfWork();
  const settings = new InMemorySettingRepository(uow);
  return { settings, useCase: new GetCompanySettings(settings) };
}

describe('GetCompanySettings', () => {
  it('reads the empty profile when the company row does not exist yet', async () => {
    const { useCase } = setup();
    await expect(useCase.execute(actor('VIEWER'))).resolves.toEqual({
      name: '',
      legalName: null,
      taxId: null,
      address: null,
      logoFileId: null,
    });
  });

  it('lets every signed-in role read the stored profile (Q-BE1-3)', async () => {
    const { settings, useCase } = setup();
    settings.seed('company', {
      name: 'WeDevs Studio',
      legalName: 'WeDevs Studio, C.A.',
      taxId: 'J-12345678-9',
      address: 'Calle Demo 1, Caracas',
      logoFileId: 'fil_logo',
    });
    for (const role of ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const) {
      await expect(useCase.execute(actor(role))).resolves.toMatchObject({
        name: 'WeDevs Studio',
        taxId: 'J-12345678-9',
        logoFileId: 'fil_logo',
      });
    }
  });
});
