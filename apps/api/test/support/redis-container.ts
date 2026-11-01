import { existsSync } from 'node:fs';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

export interface RedisContainer {
  /** `redis://host:port` of the throwaway instance. */
  readonly url: string;
  stop(): Promise<void>;
}

/**
 * A throwaway `redis:7` per spec file, started only by specs that need it (DT-169). Never connects to a
 * Redis the user owns (C26). The caller stops it in `afterAll`.
 */
export async function startRedis(): Promise<RedisContainer> {
  usePodmanSocketWhenNoDocker();
  const container: StartedTestContainer = await new GenericContainer('docker.io/library/redis:7')
    .withExposedPorts(6379)
    .withLabels({ 'wedevs.test': 'api-redis' })
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .withStartupTimeout(60_000)
    .start();
  return {
    url: `redis://${container.getHost()}:${container.getMappedPort(6379)}`,
    stop: async () => {
      await container.stop();
    },
  };
}

/** Same podman fallback as `global-setup.ts`: rootless socket, Ryuk off. */
function usePodmanSocketWhenNoDocker(): void {
  if (process.env.DOCKER_HOST || existsSync('/var/run/docker.sock')) return;
  const socket = `/run/user/${process.getuid?.()}/podman/podman.sock`;
  if (!existsSync(socket)) return;
  process.env.DOCKER_HOST = `unix://${socket}`;
  process.env.TESTCONTAINERS_RYUK_DISABLED ??= 'true';
}
