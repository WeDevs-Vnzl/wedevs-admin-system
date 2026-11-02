import { startWorker } from './worker.module';

startWorker().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Failed to start the worker');
  process.exit(1);
});
