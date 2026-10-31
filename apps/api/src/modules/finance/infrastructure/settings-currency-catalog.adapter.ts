import { Injectable } from '@nestjs/common';
import { CurrencyCatalogQuery } from '../../settings/application/currency-catalog.query';
import type { CurrencyCatalogPort } from '../application/ports/currency-catalog.port';

/** `CurrencyCatalogPort` over settings' exported `CurrencyCatalogQuery` (rule (e)). */
@Injectable()
export class SettingsCurrencyCatalogAdapter implements CurrencyCatalogPort {
  constructor(private readonly catalog: CurrencyCatalogQuery) {}

  knownCodes(codes: readonly string[]): Promise<ReadonlySet<string>> {
    return this.catalog.knownCodes(codes);
  }
}
