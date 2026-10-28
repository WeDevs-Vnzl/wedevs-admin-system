export type IsolationLevel = 'ReadCommitted' | 'RepeatableRead' | 'Serializable';

export interface UnitOfWorkOptions {
  readonly isolation?: IsolationLevel;
}

/**
 * Runs `work` in one transaction. The transaction is ambient: no transaction object crosses the port.
 * A nested `run` joins the outer one; an error rolls everything back.
 *
 * Isolation order: `ReadCommitted` < `RepeatableRead` < `Serializable`. A nested `run` with an equal,
 * weaker or omitted level joins as is. One requesting a stricter level than the outermost run throws a
 * plain `Error` naming both levels (a programming error, not a `DomainError`): a use case that needs
 * `Serializable` must open the outermost unit of work.
 */
export interface UnitOfWorkPort {
  run<T>(work: () => Promise<T>, options?: UnitOfWorkOptions): Promise<T>;
}
