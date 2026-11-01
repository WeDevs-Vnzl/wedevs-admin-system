import { entityMetricsReadContract } from '../../support/contracts/entity-metrics-read.contract';
import { InMemoryEntityMetricsRead } from '../../support/fakes/in-memory-entity-metrics-read';

entityMetricsReadContract('in-memory', () => {
  const port = new InMemoryEntityMetricsRead();
  return {
    port,
    addClient: async (seed) => port.addClient(seed),
    addProject: async (seed) => port.addProject(seed),
  };
});
