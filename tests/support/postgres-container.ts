import { randomUUID } from "node:crypto";
import { createServer } from "node:net";

import postgres from "postgres";

const postgresImage = "postgres:16-alpine";
const postgresDatabase = "slopwatch";
const postgresUser = "slopwatch";
const postgresPassword = "slopwatch";

export type ProcessResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type DockerPostgresDependencies = {
  dockerPath?: string;
  getAvailablePort?: () => Promise<number>;
  randomId?: () => string;
  runProcess?: (command: string[]) => Promise<ProcessResult>;
  sleep?: (milliseconds: number) => Promise<void>;
  pingDatabase?: (databaseUrl: string) => Promise<void>;
};

export async function withIsolatedPostgres(
  run: ({ databaseUrl }: { databaseUrl: string }) => Promise<void>,
  dependencies: DockerPostgresDependencies = {},
) {
  const dockerPath = dependencies.dockerPath ?? requireDockerPath();
  const getPort = dependencies.getAvailablePort ?? getAvailablePort;
  const runProcess = dependencies.runProcess ?? runProcessCommand;
  const randomId = dependencies.randomId ?? (() => randomUUID());
  const sleep = dependencies.sleep ?? Bun.sleep;
  const pingDatabase = dependencies.pingDatabase ?? pingPostgresDatabase;
  const port = await getPort();
  const containerName = `slopwatch-smoke-${randomId()}`;
  const databaseUrl = `postgres://${postgresUser}:${postgresPassword}@127.0.0.1:${port}/${postgresDatabase}`;

  await runSuccessfulProcess(
    [
      dockerPath,
      "run",
      "--detach",
      "--rm",
      "--name",
      containerName,
      "--publish",
      `127.0.0.1:${port}:5432`,
      "--env",
      `POSTGRES_DB=${postgresDatabase}`,
      "--env",
      `POSTGRES_USER=${postgresUser}`,
      "--env",
      `POSTGRES_PASSWORD=${postgresPassword}`,
      postgresImage,
    ],
    runProcess,
  );

  try {
    await waitForPostgresReady({
      dockerPath,
      containerName,
      databaseUrl,
      runProcess,
      sleep,
      pingDatabase,
    });

    await run({ databaseUrl });
  } finally {
    await runSuccessfulProcess(
      [dockerPath, "rm", "--force", containerName],
      runProcess,
    );
  }
}

async function waitForPostgresReady({
  dockerPath,
  containerName,
  databaseUrl,
  runProcess,
  sleep,
  pingDatabase,
}: {
  dockerPath: string;
  containerName: string;
  databaseUrl: string;
  runProcess: (command: string[]) => Promise<ProcessResult>;
  sleep: (milliseconds: number) => Promise<void>;
  pingDatabase: (databaseUrl: string) => Promise<void>;
}) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 30_000) {
    const result = await runProcess([
      dockerPath,
      "exec",
      containerName,
      "pg_isready",
      "--username",
      postgresUser,
      "--dbname",
      postgresDatabase,
    ]);

    if (result.exitCode === 0) {
      try {
        await pingDatabase(databaseUrl);
        return;
      } catch {
        // The server can answer pg_isready before TCP SQL queries succeed.
      }
    }

    await sleep(100);
  }

  throw new Error("Timed out waiting for Docker Postgres to become ready.");
}

async function runSuccessfulProcess(
  command: string[],
  runProcess: (command: string[]) => Promise<ProcessResult>,
) {
  const result = await runProcess(command);

  if (result.exitCode !== 0) {
    throw new Error(
      [
        `${command[0]} exited with ${result.exitCode}.`,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return result;
}

async function runProcessCommand(command: string[]): Promise<ProcessResult> {
  const proc = Bun.spawn(command, {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = new Response(proc.stdout).text();
  const stderr = new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return { stdout: await stdout, stderr: await stderr, exitCode };
}

async function pingPostgresDatabase(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 1, connect_timeout: 1 });

  try {
    await client`SELECT 1`;
  } finally {
    await client.end();
  }
}

function requireDockerPath() {
  const dockerPath = Bun.which("docker");

  if (!dockerPath) {
    throw new Error(
      "The end-to-end smoke test requires Docker on PATH to run Postgres.",
    );
  }

  return dockerPath;
}

async function getAvailablePort() {
  return await new Promise<number>((resolve, reject) => {
    const probe = createServer();

    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();

      probe.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
          return;
        }

        reject(new Error("Unable to reserve an available localhost port."));
      });
    });
  });
}
