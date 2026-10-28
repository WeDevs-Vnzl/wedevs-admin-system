import { thing } from '../domain/thing';
import { useCase } from './use-case';
import type { ThingRepository } from './ports/thing.repository.port';
import { useCase as crmUseCase } from '../../crm/application/use-case';
import { base } from '../../../shared/domain/base';
import type { ClockPort } from '../../../shared/application/clock.port';

export type Deps = [ThingRepository, ClockPort];
export const ok = [thing, useCase, crmUseCase, base];
