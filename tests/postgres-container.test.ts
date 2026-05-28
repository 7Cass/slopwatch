import { expect, test } from "bun:test";

import { withIsolatedPostgres } from "./support/postgres-container";

test("isolated Postgres starts through docker run and exposes a stable DATABASE_URL", async () => {
  const commands: string[][] = [];
  let observedDatabaseUrl: string | undefined;

  await withIsolatedPostgres(
    async ({ databaseUrl }) => {
      observedDatabaseUrl = databaseUrl;
    },
    {
      dockerPath: "docker",
      getAvailablePort: async () => 45432,
      randomId: () => "abc123",
      pingDatabase: async () => {},
      runProcess: async (command) => {
        commands.push(command);

        return { stdout: "", stderr: "", exitCode: 0 };
      },
    },
  );

  expect(commands[0]).toEqual([
    "docker",
    "run",
    "--detach",
    "--rm",
    "--name",
    "slopwatch-smoke-abc123",
    "--publish",
    "127.0.0.1:45432:5432",
    "--env",
    "POSTGRES_DB=slopwatch",
    "--env",
    "POSTGRES_USER=slopwatch",
    "--env",
    "POSTGRES_PASSWORD=slopwatch",
    "postgres:16-alpine",
  ]);
  expect(observedDatabaseUrl).toBe(
    "postgres://slopwatch:slopwatch@127.0.0.1:45432/slopwatch",
  );
});

test("isolated Postgres waits for pg_isready before running the smoke flow", async () => {
  const events: string[] = [];

  await withIsolatedPostgres(
    async () => {
      events.push("callback");
    },
    {
      dockerPath: "docker",
      getAvailablePort: async () => 45432,
      randomId: () => "abc123",
      pingDatabase: async () => {},
      runProcess: async (command) => {
        if (command.includes("pg_isready")) {
          events.push("ready");
        }

        return { stdout: "", stderr: "", exitCode: 0 };
      },
    },
  );

  expect(events).toEqual(["ready", "callback"]);
});

test("isolated Postgres retries readiness until pg_isready succeeds", async () => {
  const readyExitCodes = [1, 0];
  const commands: string[][] = [];
  const sleeps: number[] = [];

  await withIsolatedPostgres(async () => {}, {
    dockerPath: "docker",
    getAvailablePort: async () => 45432,
    randomId: () => "abc123",
    pingDatabase: async () => {},
    runProcess: async (command) => {
      commands.push(command);

      return {
        stdout: "",
        stderr: "",
        exitCode: command.includes("pg_isready")
          ? (readyExitCodes.shift() ?? 0)
          : 0,
      };
    },
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
    },
  });

  expect(commands.filter((command) => command.includes("pg_isready"))).toHaveLength(
    2,
  );
  expect(sleeps).toEqual([100]);
});

test("isolated Postgres removes the container when the smoke flow fails", async () => {
  const commands: string[][] = [];

  await expect(
    withIsolatedPostgres(
      async () => {
        throw new Error("smoke failed");
      },
      {
        dockerPath: "docker",
        getAvailablePort: async () => 45432,
        randomId: () => "abc123",
        pingDatabase: async () => {},
        runProcess: async (command) => {
          commands.push(command);

          return { stdout: "", stderr: "", exitCode: 0 };
        },
      },
    ),
  ).rejects.toThrow("smoke failed");

  expect(commands.at(-1)).toEqual([
    "docker",
    "rm",
    "--force",
    "slopwatch-smoke-abc123",
  ]);
});

test("isolated Postgres waits for a SQL connection before running the smoke flow", async () => {
  const events: string[] = [];
  let pingAttempts = 0;

  await withIsolatedPostgres(
    async () => {
      events.push("callback");
    },
    {
      dockerPath: "docker",
      getAvailablePort: async () => 45432,
      randomId: () => "abc123",
      runProcess: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
      pingDatabase: async (databaseUrl) => {
        events.push(`ping:${databaseUrl}`);
        pingAttempts += 1;

        if (pingAttempts === 1) {
          throw new Error("the database system is starting up");
        }
      },
      sleep: async () => {},
    },
  );

  expect(events).toEqual([
    "ping:postgres://slopwatch:slopwatch@127.0.0.1:45432/slopwatch",
    "ping:postgres://slopwatch:slopwatch@127.0.0.1:45432/slopwatch",
    "callback",
  ]);
});
