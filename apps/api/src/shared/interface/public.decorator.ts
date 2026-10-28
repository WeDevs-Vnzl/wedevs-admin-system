import { SetMetadata } from '@nestjs/common';

/** Metadata key read by the BE-1 Clerk guard (C24). */
export const IS_PUBLIC_KEY = 'isPublic';

/** Marks a route as public (no JWT). Only health, portal and webhooks use it (`api-contract.md` §5). */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
