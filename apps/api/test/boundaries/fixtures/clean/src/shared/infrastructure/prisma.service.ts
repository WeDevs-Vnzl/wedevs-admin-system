import { PrismaClient } from '@prisma/client';
import type { ClockPort } from '../application/clock.port';

export const client = PrismaClient;
export type Clock = ClockPort;
