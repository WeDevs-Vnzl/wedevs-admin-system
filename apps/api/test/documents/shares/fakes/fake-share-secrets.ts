import type {
  ShareSecretsPort,
  UnlockCookieInput,
} from '../../../../src/modules/documents/application/ports/share-secrets.port';
import type { InMemoryUnitOfWork } from '../../../support/fakes/in-memory-unit-of-work';

/** Deterministic secrets: the "hash" is `hash:<key>` so a test can match it, and nothing real is derived. */
export class FakeShareSecrets implements ShareSecretsPort {
  private tokens = 0;
  private keys = 0;
  /** `true` for each `hashKey` call made while a unit of work was open: it must stay empty (A1). */
  readonly hashedInsideUow: boolean[] = [];
  readonly generatedKeys: string[] = [];

  constructor(private readonly uow?: InMemoryUnitOfWork) {}

  generateToken(): string {
    this.tokens += 1;
    return `T${String(this.tokens).padStart(42, '0')}`;
  }

  generateKey(): string {
    this.keys += 1;
    const key = `KEYS-ABCD-${String(this.keys).padStart(4, '0')}-WXYZ`;
    this.generatedKeys.push(key);
    return key;
  }

  async hashKey(key: string): Promise<string> {
    this.hashedInsideUow.push(this.uow?.isActive ?? false);
    return `hash:${key}`;
  }

  async verifyKey(key: string, stored: string): Promise<boolean> {
    return stored === `hash:${key}`;
  }

  signUnlock(_input: UnlockCookieInput): string {
    throw new Error('not used by the management use cases');
  }

  verifyUnlock(): string[] {
    throw new Error('not used by the management use cases');
  }

  hashIp(ip: string): string {
    return `ip:${ip}`;
  }
}
