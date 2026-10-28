import { base } from '../domain/base';

export interface ClockPort {
  now(): Date;
}
export const clockBase = base;
