import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { GenericContainer, getContainerRuntimeClient, Wait } from 'testcontainers';
import type { TestProject } from 'vitest/node';
import { assertLocalDatabaseUrl } from './local-db-guard';
import { asAdmin, TEMPLATE_DATABASE, withDatabase } from './test-database';

const run = promisify(execFile);
const ROOT = resolve(__dirname, '../..');
const bin = (name: string) => resolve(ROOT, 'node_modules/.bin', name);
/** Marks the run's container so a later run can remove it if this one is killed before teardown. */
const LABEL = 'wedevs.test';
const LABEL_VALUE = 'api-postgres';
/** Longer than any run, so a concurrent run in another worktree keeps its container. */
const STALE_AFTER_SECONDS = 60 * 60;

/**
 * One throwaway PostgreSQL per project run (DT-117). The template database is migrated and seeded once; each
 * spec file clones it (`spec-database.ts`). No manually started container is needed.
 */
export default async function setup(project: TestProject) {
  usePodmanSocketWhenNoDocker();
  await removeStaleContainers();
  // Not PostgreSqlContainer: its healthcheck execs `pg_isready` for the container's life, and under load an
  // exec that times out leaves an orphan the postmaster reaps as a crashed backend, restarting the cluster.
  const container = await new GenericContainer('docker.io/library/postgres:17')
    .withEnvironment({ POSTGRES_PASSWORD: 'dev', POSTGRES_DB: 'postgres' })
    // Throwaway data, so no durability: each spec's DROP DATABASE forces a checkpoint, and with fsync on,
    // checkpoints queue behind a busy disk.
    .withCommand([
      'postgres',
      '-c',
      'fsync=off',
      '-c',
      'synchronous_commit=off',
      '-c',
      'full_page_writes=off',
    ])
    .withExposedPorts(5432)
    .withLabels({ [LABEL]: LABEL_VALUE })
    // Logged by the init server and again by the real one.
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .withStartupTimeout(120_000)
    .start();
  try {
    const serverUrl = assertLocalDatabaseUrl(
      `postgresql://postgres:dev@${container.getHost()}:${container.getMappedPort(5432)}/postgres`,
    );
    await asAdmin(serverUrl, async (admin) => {
      await admin.query(`CREATE DATABASE ${TEMPLATE_DATABASE}`);
    });
    // Both child processes exit before any clone: the template must have no open connections.
    const templateUrl = withDatabase(serverUrl, TEMPLATE_DATABASE);
    const env = { ...process.env, DATABASE_URL: templateUrl, DIRECT_URL: templateUrl };
    await run(bin('prisma'), ['migrate', 'deploy'], { cwd: ROOT, env });
    await run(bin('tsx'), ['prisma/seed.ts'], { cwd: ROOT, env });
    project.provide('postgresUrl', serverUrl);
  } catch (error) {
    // With Ryuk disabled nothing else stops the container: a failed setup returns no teardown.
    await container.stop();
    throw error;
  }
  return async () => {
    await container.stop();
  };
}

/**
 * With Ryuk disabled, a run killed before its teardown (Ctrl-C, SIGKILL) leaves its container running. Removes
 * the labelled ones older than any run.
 */
async function removeStaleContainers(): Promise<void> {
  const { dockerode } = (await getContainerRuntimeClient()).container;
  const containers = await dockerode.listContainers({
    all: true,
    filters: { label: [`${LABEL}=${LABEL_VALUE}`] },
  });
  const cutoff = Date.now() / 1000 - STALE_AFTER_SECONDS;
  await Promise.all(
    containers
      .filter((info) => info.Created < cutoff)
      .map((info) => dockerode.getContainer(info.Id).remove({ force: true })),
  );
}

/**
 * Testcontainers looks for the Docker socket only. On a podman-only machine, point it at the rootless podman
 * socket (`systemctl --user start podman.socket`) and disable Ryuk, which podman cannot run rootless.
 */
function usePodmanSocketWhenNoDocker(): void {
  if (process.env.DOCKER_HOST || existsSync('/var/run/docker.sock')) return;
  const socket = `/run/user/${process.getuid?.()}/podman/podman.sock`;
  if (!existsSync(socket)) return;
  process.env.DOCKER_HOST = `unix://${socket}`;
  process.env.TESTCONTAINERS_RYUK_DISABLED ??= 'true';
}

declare module 'vitest' {
  export interface ProvidedContext {
    /** Owner connection to the run's PostgreSQL (its `postgres` database). */
    postgresUrl: string;
  }
}
