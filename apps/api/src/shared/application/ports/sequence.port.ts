export const SEQUENCE_NAMES = ['CLI', 'PRY', 'FAC', 'PAG', 'GAS', 'DOC'] as const;
export type SequenceName = (typeof SEQUENCE_NAMES)[number];

/**
 * Allocates the next code of a sequence as `<PREFIX>-<value padded to 4>` (`CLI-0001`, `CLI-10000`;
 * data-rules.md §5). Valid only inside `UnitOfWorkPort.run`; a rollback consumes nothing.
 */
export interface SequencePort {
  next(name: SequenceName): Promise<string>;
}
