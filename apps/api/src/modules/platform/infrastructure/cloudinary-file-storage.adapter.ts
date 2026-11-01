import { v2 as cloudinary } from 'cloudinary';
import type { ClockPort } from '../../../shared/application/ports/clock.port';
import type {
  FileDisposition,
  FileStoragePort,
  UploadIntent,
} from '../application/ports/file-storage.port';
import type { UploadContext } from '../domain/upload-rules';

export interface CloudinaryCredentials {
  readonly cloudName: string;
  readonly apiKey: string;
  readonly apiSecret: string;
}

/**
 * Every asset is stored as `resource_type: raw`, `type: authenticated`: not reachable by a plain URL, only
 * through a signed one (DT-85). The public id is the `storageKey`.
 */
const RESOURCE_TYPE = 'raw';
const DELIVERY_TYPE = 'authenticated';
const API_ORIGIN = 'https://api.cloudinary.com';
const REQUEST_TIMEOUT_MS = 10_000;

type FetchFn = typeof fetch;

/**
 * Cloudinary adapter of `FileStoragePort`. Signing uses the SDK's pure helpers with the credentials passed
 * per call (no global SDK state); the few HTTP calls go through an injectable `fetch`, so tests never touch
 * the network. No SDK type leaves this class (DT-85); failures are plain `Error`s without secrets or URLs.
 */
export class CloudinaryFileStorage implements FileStoragePort {
  readonly bucket: string;

  constructor(
    private readonly credentials: CloudinaryCredentials,
    private readonly clock: ClockPort,
    private readonly http: FetchFn = fetch,
  ) {
    this.bucket = credentials.cloudName;
  }

  createUploadIntent(input: {
    storageKey: string;
    context: UploadContext;
    expiresAt: Date;
  }): Promise<UploadIntent> {
    const signed = {
      public_id: input.storageKey,
      timestamp: this.timestamp(),
      type: DELIVERY_TYPE,
    };
    const signature = cloudinary.utils.api_sign_request(signed, this.credentials.apiSecret);
    return Promise.resolve({
      url: `${API_ORIGIN}/v1_1/${this.credentials.cloudName}/${RESOURCE_TYPE}/upload`,
      fields: {
        api_key: this.credentials.apiKey,
        public_id: signed.public_id,
        timestamp: String(signed.timestamp),
        type: signed.type,
        signature,
      },
      expiresAt: input.expiresAt,
    });
  }

  async getObjectInfo(storageKey: string): Promise<{ bytes: number } | null> {
    const path = [RESOURCE_TYPE, DELIVERY_TYPE, ...storageKey.split('/')]
      .map(encodeURIComponent)
      .join('/');
    const response = await this.http(
      `${API_ORIGIN}/v1_1/${this.credentials.cloudName}/resources/${path}`,
      {
        headers: { Authorization: this.basicAuth() },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Cloudinary resource lookup failed (${response.status})`);
    const body = (await response.json()) as { bytes?: unknown };
    if (typeof body.bytes !== 'number') throw new Error('Cloudinary resource lookup: no byte size');
    return { bytes: body.bytes };
  }

  async readHead(storageKey: string, n: number): Promise<Uint8Array> {
    const url = cloudinary.url(storageKey, {
      resource_type: RESOURCE_TYPE,
      type: DELIVERY_TYPE,
      sign_url: true,
      secure: true,
      cloud_name: this.credentials.cloudName,
      api_key: this.credentials.apiKey,
      api_secret: this.credentials.apiSecret,
    });
    const response = await this.http(url, {
      headers: { Range: `bytes=0-${n - 1}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok || !response.body) {
      throw new Error(`Cloudinary head read failed (${response.status})`);
    }
    // A server that ignores `Range` answers 200 with the whole object: keep only the first `n` bytes.
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < n) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
    await reader.cancel().catch(() => undefined);
    const out = new Uint8Array(Math.min(total, n));
    let offset = 0;
    for (const chunk of chunks) {
      const slice = chunk.subarray(0, Math.max(0, out.length - offset));
      out.set(slice, offset);
      offset += slice.byteLength;
    }
    return out;
  }

  signedDownloadUrl(
    storageKey: string,
    input: { fileName: string; expiresAt: Date; disposition?: FileDisposition },
  ): Promise<string> {
    // Cloudinary's API download endpoint signs `expires_at`, so the URL stops working by itself.
    // The SDK's typings omit the credential options it reads and type `attachment` as a boolean while
    // forwarding a string as the download file name.
    // `inline` omits `attachment`, so the API does not force `Content-Disposition: attachment`; the
    // real behaviour of the private download URL is checked live by the user (DT-85), never by an agent.
    const disposition = input.disposition === 'inline' ? {} : { attachment: input.fileName };
    const options = {
      resource_type: RESOURCE_TYPE,
      type: DELIVERY_TYPE,
      ...disposition,
      expires_at: Math.floor(input.expiresAt.getTime() / 1000),
      cloud_name: this.credentials.cloudName,
      api_key: this.credentials.apiKey,
      api_secret: this.credentials.apiSecret,
    };
    return Promise.resolve(
      cloudinary.utils.private_download_url(
        storageKey,
        '',
        options as unknown as Parameters<typeof cloudinary.utils.private_download_url>[2],
      ),
    );
  }

  async destroy(storageKey: string): Promise<void> {
    const signed = { public_id: storageKey, timestamp: this.timestamp(), type: DELIVERY_TYPE };
    const form = new URLSearchParams({
      ...Object.fromEntries(Object.entries(signed).map(([k, v]) => [k, String(v)])),
      api_key: this.credentials.apiKey,
      signature: cloudinary.utils.api_sign_request(signed, this.credentials.apiSecret),
    });
    const response = await this.http(
      `${API_ORIGIN}/v1_1/${this.credentials.cloudName}/${RESOURCE_TYPE}/destroy`,
      { method: 'POST', body: form, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    );
    if (!response.ok) throw new Error(`Cloudinary destroy failed (${response.status})`);
    const body = (await response.json()) as { result?: unknown };
    // `not found` means it is already gone: destroy is idempotent.
    if (body.result !== 'ok' && body.result !== 'not found') {
      throw new Error('Cloudinary destroy: unexpected result');
    }
  }

  private timestamp(): number {
    return Math.floor(this.clock.now().getTime() / 1000);
  }

  private basicAuth(): string {
    const raw = `${this.credentials.apiKey}:${this.credentials.apiSecret}`;
    return `Basic ${Buffer.from(raw).toString('base64')}`;
  }
}
