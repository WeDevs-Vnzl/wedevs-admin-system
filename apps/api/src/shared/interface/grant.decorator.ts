import 'reflect-metadata';
import { SetMetadata } from '@nestjs/common';
import type { PermissionAction, PermissionResource } from '../application/authorization';
import { IS_PUBLIC_KEY } from './public.decorator';

export const IS_AUTHENTICATED_KEY = 'isAuthenticated';
export const REQUIRES_GRANT_KEY = 'requiresGrant';

export interface GrantRequirement {
  readonly resource: PermissionResource;
  readonly action: PermissionAction;
}

/**
 * Route is for any authenticated user; the use case runs `can()` itself (DT-71, DT-79). Generic: it
 * encodes no per-resource rule.
 */
export const Authenticated = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_AUTHENTICATED_KEY, true);

/** Coarse route-level grant check; the use case's `can()` stays the authority (C13). */
export const RequiresGrant = (
  resource: PermissionResource,
  action: PermissionAction,
): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRES_GRANT_KEY, { resource, action } satisfies GrantRequirement);

export type RouteGrant =
  | { readonly kind: 'public' }
  | { readonly kind: 'authenticated' }
  | {
      readonly kind: 'grant';
      readonly resource: PermissionResource;
      readonly action: PermissionAction;
    }
  | { readonly kind: 'missing' }
  | { readonly kind: 'conflict' };

type Target = object | ((...args: never[]) => unknown);

function read<T>(key: string, handler: Target, controller: Target): T | undefined {
  return (
    (Reflect.getMetadata(key, handler) as T | undefined) ??
    (Reflect.getMetadata(key, controller) as T | undefined)
  );
}

/**
 * Reads the single grant declaration of a route (handler first, then its controller class). More than one
 * kind of declaration is a `conflict`, none is `missing`; the guard denies both (fail-closed).
 */
export function readRouteGrant(handler: Target, controller: Target): RouteGrant {
  const isPublic = read<boolean>(IS_PUBLIC_KEY, handler, controller) === true;
  const isAuthenticated = read<boolean>(IS_AUTHENTICATED_KEY, handler, controller) === true;
  const requirement = read<GrantRequirement>(REQUIRES_GRANT_KEY, handler, controller);

  const declared = [isPublic, isAuthenticated, requirement !== undefined].filter(Boolean).length;
  if (declared === 0) return { kind: 'missing' };
  if (declared > 1) return { kind: 'conflict' };
  if (isPublic) return { kind: 'public' };
  if (isAuthenticated) return { kind: 'authenticated' };
  if (requirement === undefined) return { kind: 'missing' };
  return { kind: 'grant', resource: requirement.resource, action: requirement.action };
}
