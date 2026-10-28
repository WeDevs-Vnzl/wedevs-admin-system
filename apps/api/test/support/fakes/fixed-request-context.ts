import type {
  RequestContextPort,
  RequestMetadata,
} from '../../../src/shared/application/ports/request-context.port';

/** Fake `RequestContextPort`: a settable metadata value; `run` overrides it for the duration of `fn`. */
export class FixedRequestContext implements RequestContextPort {
  constructor(private meta: RequestMetadata | null = null) {}

  set(meta: RequestMetadata | null): void {
    this.meta = meta;
  }

  current(): RequestMetadata | null {
    return this.meta;
  }

  run<T>(meta: RequestMetadata, fn: () => T): T {
    const previous = this.meta;
    this.meta = meta;
    let result: T;
    try {
      result = fn();
    } catch (error) {
      this.meta = previous;
      throw error;
    }
    if (result instanceof Promise) {
      return result.finally(() => {
        this.meta = previous;
      }) as T;
    }
    this.meta = previous;
    return result;
  }
}
