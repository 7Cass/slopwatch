import { afterEach, expect, test } from "bun:test";

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";

import {
  DashboardRoutes,
  type SerializedAgentDetail,
  type SerializedNowProjection,
} from "../src/dashboard/App";
import { withIsolatedPostgres } from "./support/postgres-container";

const cliPath = new URL("../src/cli.ts", import.meta.url).pathname;

const tmpRoots: string[] = [];

afterEach(async () => {
  const roots = tmpRoots.splice(0);

  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

test("smoke flow proves migrate, fixture collection, SSE, and dashboard rendering end to end", async () => {
  await withIsolatedPostgres(async ({ databaseUrl }) => {
    const sourceRoot = await tempRoot("slopwatch-smoke-source-");
    const env = smokeEnv({
      CODEX_HOME: join(sourceRoot, "missing-codex-source"),
    });
    const unmigratedPort = await getAvailablePort();
    const unmigratedServe = await runCli(
      [
        "serve",
        "--database-url",
        databaseUrl,
        "--host",
        "127.0.0.1",
        "--port",
        String(unmigratedPort),
      ],
      env,
      { timeoutMs: 5_000 },
    );

    expect(unmigratedServe.exitCode).toBe(1);
    expect(unmigratedServe.stderr).toContain("Run slopwatch db migrate");

    const migrate = await runCli(
      ["db", "migrate", "--database-url", databaseUrl],
      env,
    );

    expect(migrate).toMatchObject({
      exitCode: 0,
      stderr: "",
    });
    expect(migrate.stdout).toContain("Database migrations applied.");

    const collect = await runCli(
      ["collect", "--fixture", "--database-url", databaseUrl],
      env,
    );

    expect(collect).toMatchObject({
      exitCode: 0,
      stderr: "",
    });
    expect(collect.stdout).toContain(
      "Collected 3 fixture Events for 1 WorkUnit.",
    );

    const backfill = await runCli(
      [
        "collect",
        "--fixture",
        "--since",
        "2026-05-01T10:02:00.000Z",
        "--database-url",
        databaseUrl,
      ],
      env,
    );

    expect(backfill).toMatchObject({
      exitCode: 0,
      stderr: "",
    });
    expect(backfill.stdout).toContain(
      "Collected 2 fixture Events for 1 WorkUnit since 2026-05-01T10:02:00.000Z.",
    );

    const server = await startCliServer({ databaseUrl, env });

    try {
      const nowEvent = await readFirstSseEvent(`${server.url}/api/now/events`);

      expect(nowEvent.event).toBe("now");
      expect(nowEvent.data).toMatchObject({
        groups: [
          { key: "blocked", agents: [] },
          {
            key: "active",
            agents: [
              {
                project: {
                  displayName: "slopwatch-demo",
                  rootPath: "/projects/slopwatch-demo",
                },
                state: "active",
                lastAction: "reported progress",
              },
            ],
          },
          { key: "failed", agents: [] },
          { key: "recently_finished", agents: [] },
        ],
      });

      const projection = await fetchJson<SerializedNowProjection>(
        `${server.url}/api/now`,
      );
      const agents = projection.groups.flatMap((group) => group.agents);

      expect(agents).toHaveLength(1);

      const [agent] = agents;

      if (!agent) {
        throw new Error("Expected fixture collection to expose one Agent.");
      }

      const detail = await fetchJson<SerializedAgentDetail>(
        `${server.url}/api/agents/${encodeURIComponent(agent.workUnitId)}`,
      );

      expect(detail).toMatchObject({
        workUnitId: agent.workUnitId,
        project: {
          displayName: "slopwatch-demo",
          rootPath: "/projects/slopwatch-demo",
        },
        state: "active",
        inference: {
          inferenceVersion: "work-unit-inference-v1",
        },
      });
      expect(detail.events.map((event) => event.source.sourceLocator)).toEqual([
        "fixture/codex-local-demo/session-001/fork-main/0001",
        "fixture/codex-local-demo/session-001/fork-main/0002",
        "fixture/codex-local-demo/session-001/fork-main/0003",
      ]);

      const markup = renderToStaticMarkup(
        <StaticRouter location="/">
          <DashboardRoutes initialProjection={projection} />
        </StaticRouter>,
      );

      expect(markup).toContain("slopwatch-demo");
      expect(markup).toContain("Active");
      expect(markup).toContain("reported progress");
      expect(markup).toContain("4m active");
      expect(markup).toContain("1 tool call");
      expect(markup).toContain("not tracked");
      expect(markup).toContain(
        `href="/agents/${encodeURIComponent(agent.workUnitId)}"`,
      );
    } finally {
      await server.stop();
    }
  });
});

type ProcessEnv = Record<string, string | undefined>;

type CliResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

type RunningCliServer = {
  url: string;
  stop: () => Promise<void>;
};

async function startCliServer({
  databaseUrl,
  env,
}: {
  databaseUrl: string;
  env: ProcessEnv;
}): Promise<RunningCliServer> {
  const port = await getAvailablePort();
  const url = `http://127.0.0.1:${port}`;
  const proc = Bun.spawn(
    [
      "bun",
      "run",
      cliPath,
      "serve",
      "--database-url",
      databaseUrl,
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
      env,
    },
  );

  try {
    await waitForServer(url, proc);
  } catch (error) {
    proc.kill();

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    throw new Error(
      [
        error instanceof Error ? error.message : String(error),
        stdout,
        stderr,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return {
    url,
    stop: async () => {
      proc.kill();
      await proc.exited;
    },
  };
}

async function runCli(
  args: string[],
  env: ProcessEnv = smokeEnv(),
  options: { timeoutMs?: number } = {},
): Promise<CliResult> {
  return await runProcess(["bun", "run", cliPath, ...args], env, options);
}

async function runProcess(
  command: string[],
  env: ProcessEnv = smokeEnv(),
  options: { timeoutMs?: number } = {},
): Promise<CliResult> {
  const proc = Bun.spawn(command, {
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const stdout = new Response(proc.stdout).text();
  const stderr = new Response(proc.stderr).text();
  const exitCode = await waitForProcessExit(proc, {
    command,
    timeoutMs: options.timeoutMs,
  });

  return { stdout: await stdout, stderr: await stderr, exitCode };
}

async function waitForProcessExit(
  proc: Bun.Subprocess,
  {
    command,
    timeoutMs,
  }: {
    command: string[];
    timeoutMs?: number;
  },
) {
  if (!timeoutMs) {
    return await proc.exited;
  }

  const exitCode = await Promise.race([
    proc.exited,
    Bun.sleep(timeoutMs).then(() => "timeout" as const),
  ]);

  if (exitCode !== "timeout") {
    return exitCode;
  }

  proc.kill();
  await proc.exited;

  throw new Error(`${command[0]} timed out after ${timeoutMs}ms.`);
}

async function waitForServer(url: string, proc: Bun.Subprocess) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 10_000) {
    if (
      (await Promise.race([proc.exited, Bun.sleep(0).then(() => null)])) !==
      null
    ) {
      throw new Error("slopwatch serve exited before /health became ready.");
    }

    try {
      const response = await fetch(`${url}/health`);

      if (response.ok) {
        return;
      }
    } catch {
      // Server may not have bound the socket yet.
    }

    await Bun.sleep(50);
  }

  throw new Error("Timed out waiting for slopwatch serve to become ready.");
}

async function readFirstSseEvent(url: string) {
  const response = await fetch(url);

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/event-stream");

  if (!response.body) {
    throw new Error("Expected SSE response to include a body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";

  try {
    while (!buffered.includes("\n\n")) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffered += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel();
  }

  return parseSseEvent(buffered.slice(0, buffered.indexOf("\n\n")));
}

function parseSseEvent(rawEvent: string): { event?: string; data: unknown } {
  const dataLines: string[] = [];
  let eventName: string | undefined;

  for (const line of rawEvent.split("\n")) {
    if (line.startsWith("event: ")) {
      eventName = line.slice("event: ".length);
    }

    if (line.startsWith("data: ")) {
      dataLines.push(line.slice("data: ".length));
    }
  }

  return {
    event: eventName,
    data: JSON.parse(dataLines.join("\n")),
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);

  expect(response.status).toBe(200);

  return (await response.json()) as T;
}

async function tempRoot(prefix: string) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  tmpRoots.push(root);
  await mkdir(root, { recursive: true });

  return root;
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

function smokeEnv(overrides: ProcessEnv = {}): ProcessEnv {
  const env: ProcessEnv = {
    ...Bun.env,
    NO_COLOR: "1",
    ...overrides,
  };

  delete env.DATABASE_URL;

  return env;
}
