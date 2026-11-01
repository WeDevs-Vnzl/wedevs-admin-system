// The deterministic interleaving helpers of BE-2 (`Gate`, `gated`, `interleave`) plus the finance
// read-model world; the money slices of wave 3 add their own builders here.
export { Gate, gated, interleave } from '../../commercial/concurrency/world';
export {
  buildWorld,
  catalogIds,
  seedAccount,
  seedClient,
  seedInvoice,
  seedProject,
  type World,
  type WorldHooks,
} from '../read-models/world';
