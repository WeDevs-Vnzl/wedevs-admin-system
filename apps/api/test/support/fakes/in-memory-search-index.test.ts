import { InMemorySearchIndex } from './in-memory-search-index';
import { InMemoryUnitOfWork } from './in-memory-unit-of-work';
import { searchIndexSetTextsContract } from './search-index-set-texts.contract';

searchIndexSetTextsContract('InMemory', () => {
  const uow = new InMemoryUnitOfWork();
  const index = new InMemorySearchIndex(uow);
  return {
    uow,
    index,
    read: async (type, id) => index.get(type, id) ?? null,
    // The fake has no `updatedAt`: an unchanged row is observed through its content.
    updatedAt: async () => null,
  };
});
