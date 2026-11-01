import { financeFactsReadContract } from '../../support/contracts/finance-facts-read.contract';
import { InMemoryFinanceFactsRead } from '../../support/fakes/in-memory-finance-facts-read';

financeFactsReadContract('in-memory', () => {
  const port = new InMemoryFinanceFactsRead();
  return {
    port,
    addFact: async (fact) => port.addFact(fact),
    tag: async (tagId, assigned) => port.tag(tagId, assigned),
    addCategory: async (id, parentId) => port.addCategory(id, parentId ?? null),
  };
});
