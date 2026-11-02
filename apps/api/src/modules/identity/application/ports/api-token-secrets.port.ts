export const API_TOKEN_SECRETS = Symbol('API_TOKEN_SECRETS');

export interface GeneratedApiTokenSecret {
  /** The full secret, shown once. */
  readonly secret: string;
  readonly prefix: string;
  /** Hex SHA-256 of the secret. */
  readonly hash: string;
}

/** Randomness and hashing of personal access token secrets, kept out of the application layer. */
export interface ApiTokenSecretsPort {
  generate(): GeneratedApiTokenSecret;
  hash(secret: string): string;
  /** Constant-time comparison of two hex digests. */
  equals(left: string, right: string): boolean;
}
