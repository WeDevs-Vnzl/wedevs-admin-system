import { describe, expect, it } from 'vitest';
import { InMemorySettingRepository } from '../../../../test/settings/fakes/in-memory-setting.repository';
import { InMemoryUnitOfWork } from '../../../../test/support/fakes/in-memory-unit-of-work';
import { COMPANY_SETTING_KEY } from '../domain/company-settings';
import { CompanyLogoFileAccessResolver } from './company-logo-file-access.resolver';

function setup() {
  const settings = new InMemorySettingRepository(new InMemoryUnitOfWork());
  return { settings, resolver: new CompanyLogoFileAccessResolver(settings) };
}

describe('CompanyLogoFileAccessResolver', () => {
  it('claims the current company logo for any authenticated user', async () => {
    const { settings, resolver } = setup();
    settings.seed(COMPANY_SETTING_KEY, { name: 'Acme', logoFileId: 'fil_logo' });
    expect(await resolver.resolve('fil_logo')).toEqual({ kind: 'authenticated' });
  });

  it('does not claim any other file', async () => {
    const { settings, resolver } = setup();
    settings.seed(COMPANY_SETTING_KEY, { name: 'Acme', logoFileId: 'fil_logo' });
    expect(await resolver.resolve('fil_other')).toBeNull();
  });

  it('claims nothing when no company is stored or it has no logo', async () => {
    const { settings, resolver } = setup();
    expect(await resolver.resolve('fil_logo')).toBeNull();
    settings.seed(COMPANY_SETTING_KEY, { name: 'Acme', logoFileId: null });
    expect(await resolver.resolve('fil_logo')).toBeNull();
  });
});
