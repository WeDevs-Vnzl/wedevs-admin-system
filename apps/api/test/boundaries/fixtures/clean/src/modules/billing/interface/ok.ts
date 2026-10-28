import { Controller } from '@nestjs/common';
import { useCase } from '../application/use-case';
import { controller } from './controller';
import { useCase as crmUseCase } from '../../crm/application/use-case';

export const ok = [Controller, useCase, controller, crmUseCase];
