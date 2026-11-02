import type {
  ExchangeBalance,
  ExchangeDeposit,
  ExchangePort,
} from '../../../src/modules/integrations/application/ports/exchange.port';

/** Fake `ExchangePort`: scripted balances and deposits, read-only like the real one. */
export class InMemoryExchange implements ExchangePort {
  constructor(
    private readonly balanceRows: ExchangeBalance[] = [],
    private readonly depositRows: ExchangeDeposit[] = [],
  ) {}

  async balances(): Promise<ExchangeBalance[]> {
    return this.balanceRows.map((row) => ({ ...row }));
  }

  async deposits(since: Date): Promise<ExchangeDeposit[]> {
    return this.depositRows
      .filter((row) => row.insertedAt.getTime() >= since.getTime())
      .sort((a, b) => a.insertedAt.getTime() - b.insertedAt.getTime())
      .map((row) => ({ ...row }));
  }
}
