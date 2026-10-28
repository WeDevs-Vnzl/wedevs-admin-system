import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import type {
  RequestContextPort,
  RequestMetadata,
} from '../application/ports/request-context.port';

/** `RequestContextPort` over `AsyncLocalStorage`. */
@Injectable()
export class AsyncLocalRequestContext implements RequestContextPort {
  private readonly storage = new AsyncLocalStorage<RequestMetadata>();

  current(): RequestMetadata | null {
    return this.storage.getStore() ?? null;
  }

  run<T>(meta: RequestMetadata, fn: () => T): T {
    return this.storage.run(meta, fn);
  }
}
