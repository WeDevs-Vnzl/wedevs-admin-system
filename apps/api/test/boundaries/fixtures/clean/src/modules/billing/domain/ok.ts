import Decimal from 'decimal.js';
import { thing } from './thing';
import { base } from '../../../shared/domain/base';

export const ok = new Decimal(1).plus(thing).plus(base);
export const at = new Date(0);
