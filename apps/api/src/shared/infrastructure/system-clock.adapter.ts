import { Injectable } from '@nestjs/common';
import type { ClockPort } from '../application/ports/clock.port';

@Injectable()
export class SystemClock implements ClockPort {
  now(): Date {
    return new Date();
  }
}
