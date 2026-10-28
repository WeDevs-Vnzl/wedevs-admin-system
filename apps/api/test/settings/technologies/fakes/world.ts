import type { CurrentUser } from '../../../../src/shared/application/current-user';
import type { ActivityEntry } from '../../../../src/shared/application/ports/activity-log.port';
import type { UserRole } from '../../../../src/shared/domain/enums';
import type { TechnologyRecord } from '../../../../src/modules/settings/domain/technology';
import { FakeAuthorization } from '../../../support/fakes/fake-authorization';
import { InMemoryActivityLog } from '../../../support/fakes/in-memory-activity-log';
import { InMemoryUnitOfWork } from '../../../support/fakes/in-memory-unit-of-work';
import { SequentialIdGenerator } from '../../../support/fakes/sequential-id-generator';
import { FakeTechnologyUsage } from './fake-technology-usage';
import { InMemoryTechnologyRepository } from './in-memory-technology.repository';

export const actor = (role: UserRole): CurrentUser => ({
  userId: `usr_${role.toLowerCase()}`,
  clerkId: `user_${role.toLowerCase()}`,
  role,
  email: `${role.toLowerCase()}@example.test`,
  name: role,
});

/** Matrix stand-in for the `settings` grants (PRD §4.3): Owner and Admin write, everyone reads. */
export const settingsPolicy = new FakeAuthorization({
  policy: (user, action, resource) =>
    resource === 'settings' && action !== 'read' && ['OWNER', 'ADMIN'].includes(user.role),
});

export const NEXT_JS: TechnologyRecord = {
  id: 'tec_next_js',
  name: 'Next.js',
  nameEn: null,
  slug: 'next-js',
  category: 'FRONTEND',
  iconSlug: 'nextdotjs',
  color: null,
  active: true,
};
export const RUST: TechnologyRecord = {
  id: 'tec_rust',
  name: 'Rust',
  nameEn: null,
  slug: 'rust',
  category: 'LENGUAJE',
  iconSlug: 'rust',
  color: null,
  active: true,
};
export const REACT: TechnologyRecord = {
  id: 'tec_react',
  name: 'React',
  nameEn: null,
  slug: 'react',
  category: 'FRONTEND',
  iconSlug: 'react',
  color: null,
  active: false,
};

/** A catalog with three technologies, one in use by two live projects (the mock's Next.js). */
export function technologyWorld(options: { seed?: readonly TechnologyRecord[] } = {}) {
  const uow = new InMemoryUnitOfWork();
  const technologies = new InMemoryTechnologyRepository(uow);
  technologies.seed(...(options.seed ?? [NEXT_JS, RUST, REACT]));
  const usage = new FakeTechnologyUsage(uow);
  usage.setLiveProjects('tec_next_js', 2);
  const activity = new InMemoryActivityLog(uow);
  const ids = new SequentialIdGenerator('tec_new');
  return { uow, technologies, usage, activity, ids, authorization: settingsPolicy };
}

export type TechnologyWorld = ReturnType<typeof technologyWorld>;

export function activityOf(world: TechnologyWorld): readonly ActivityEntry[] {
  return world.activity.entries;
}
