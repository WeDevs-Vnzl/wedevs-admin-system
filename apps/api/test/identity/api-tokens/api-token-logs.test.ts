import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiTokenAuthenticator } from '../../../src/modules/identity/infrastructure/api-token-authenticator';
import { NodeApiTokenSecrets } from '../../../src/modules/identity/infrastructure/api-token-authenticator-secrets';
import { createTokenWorld, seedOwner } from './world';

/** Captures every line written to stdout, stderr or any console method while a test runs. */
function captureLogs() {
  const lines: string[] = [];
  const push = (chunk: unknown) => {
    lines.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString());
    return true;
  };
  vi.spyOn(process.stdout, 'write').mockImplementation(push as never);
  vi.spyOn(process.stderr, 'write').mockImplementation(push as never);
  for (const m of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      lines.push(
        args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : String(a))).join(' '),
      );
    });
  }
  return lines;
}

describe('a wdc_pat_ secret never reaches a log line', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('through issue, list, revoke, success and every refusal', async () => {
    const lines = captureLogs();
    const w = createTokenWorld();
    const { actor, owner } = seedOwner(w);
    const authenticator = new ApiTokenAuthenticator(w.authenticate);
    const tokens = [];
    for (let i = 0; i < 3; i += 1) tokens.push(await w.issue.execute(actor, { name: `t${i}` }));
    await w.list.execute(actor);
    await w.revoke.execute(actor, { id: tokens[0]?.id ?? '' });
    await authenticator.authenticate(tokens[0]?.secret ?? ''); // revoked
    await authenticator.authenticate(tokens[1]?.secret ?? ''); // valid
    w.tokens.seedOwner({ ...owner, deletedAt: new Date() });
    await authenticator.authenticate(tokens[2]?.secret ?? ''); // archived owner
    await authenticator.authenticate('wdc_pat_unknown'); // malformed
    for (let i = 0; i < 10; i += 1)
      await w.issue.execute(actor, { name: 'x' }).catch(() => undefined);

    const rejections: string[] = [];
    await w.issue.execute(actor, { name: '' }).catch((e: Error) => rejections.push(e.message));
    await w.revoke
      .execute(actor, { id: 'missing' })
      .catch((e: Error) => rejections.push(e.message));

    const all = [...lines, ...rejections, JSON.stringify(w.activity.entries)].join('\n');
    for (const t of [...tokens, ...w.secrets.issued.map((secret) => ({ secret }))]) {
      expect(all).not.toContain(t.secret);
      expect(all).not.toContain(w.secrets.hash(t.secret));
    }
    // the 12-char display prefix is allowed (it is stored and listed); a full secret is not
    expect(all).not.toMatch(/wdc_pat_[A-Za-z0-9_-]{43}/);
  });

  it('with the real secrets adapter, the generated secret is absent from the captured output', async () => {
    const lines = captureLogs();
    const generated = new NodeApiTokenSecrets().generate();
    expect(generated.secret.startsWith('wdc_pat_')).toBe(true);
    expect(lines.join('\n')).not.toContain(generated.secret);
  });
});
