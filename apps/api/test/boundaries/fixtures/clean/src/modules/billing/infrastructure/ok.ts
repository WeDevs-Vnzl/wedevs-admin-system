import { PrismaClient } from '@prisma/client';
import { thing } from '../domain/thing';
import { useCase } from '../application/use-case';
import type { ThingRepository } from '../application/ports/thing.repository.port';
import { client } from '../../../shared/infrastructure/prisma.service';
import { useCase as crmUseCase } from '../../crm/application/use-case';

export type Repo = ThingRepository;
export const ok = [PrismaClient, thing, useCase, client, crmUseCase];
