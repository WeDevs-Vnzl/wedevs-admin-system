/* eslint-disable boundaries/dependencies --
   Single gateway to the generated Prisma client. `src/generated/**` is not a boundaries element yet
   (eslint.config.mjs is outside package 3.1), so this file carries the one exception; rule (f)
   (`no-restricted-imports`) still confines every other import of it to infrastructure. */
export { Prisma, PrismaClient } from '../../../generated/prisma/client';
export * as PrismaEnums from '../../../generated/prisma/enums';
