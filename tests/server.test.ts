import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { AgentDetail } from "../src/agents/detail";
import { buildNowProjection } from "../src/now/projection";
import { buildProjectsOverview } from "../src/projects/overview";
import { createServerApp } from "../src/server/app";
import { createNowUpdateBus } from "../src/server/now-updates";
import { startServer } from "../src/server/serve";

async function readSseEvents(response: Response, count: number) {
  if (!response.body) {
    throw new Error("Expected SSE response to have a body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  const events: Array<{ event?: string; data: unknown }> = [];

  try {
    while (events.length < count) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffered += decoder.decode(value, { stream: true });

      while (buffered.includes("\n\n") && events.length < count) {
        const boundary = buffered.indexOf("\n\n");
        const rawEvent = buffered.slice(0, boundary);
        buffered = buffered.slice(boundary + 2);
        const event = parseSseEvent(rawEvent);

        if (event) {
          events.push(event);
        }
      }
    }
  } finally {
    await reader.cancel();
  }

  return events;
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number) {
  return await Promise.race([
    promise,
    Bun.sleep(milliseconds).then(() => {
      throw new Error(`Timed out after ${milliseconds}ms.`);
    }),
  ]);
}

function parseSseEvent(rawEvent: string) {
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

  if (dataLines.length === 0) {
    return null;
  }

  return {
    event: eventName,
    data: JSON.parse(dataLines.join("\n")) as unknown,
  };
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

function projectionForAgent(workUnitId: string) {
  return buildNowProjection({
    now: new Date("2026-05-01T10:10:00.000Z"),
    records: [
      {
        workUnitId,
        project: {
          displayName: "slopwatch-demo",
          rootPath: "/projects/slopwatch-demo",
        },
        state: "active",
        confidence: 0.7,
        explanation: "detail-only field",
        activeTimeMs: 4 * 60 * 1000,
        lastActivityAt: new Date("2026-05-01T10:04:00.000Z"),
        lastAction: "reported progress",
        toolCalls: 1,
        tokenQuality: "unavailable",
      },
    ],
  });
}

function detailForAgent(workUnitId: string): AgentDetail {
  return {
    workUnitId,
    project: {
      displayName: "slopwatch-demo",
      rootPath: "/projects/slopwatch-demo",
    },
    state: "active",
    activeTimeMs: 4 * 60 * 1000,
    lastActivityAt: "2026-05-01T10:04:00.000Z",
    inference: {
      confidence: 0.82,
      explanation: "Derived from recent tool and message Events.",
      inferenceVersion: "work-unit-inference-v1",
      calculatedAt: "2026-05-01T10:05:00.000Z",
    },
    forkOrigin: {
      sourceForkId: "fork-main",
      originForkId: "fork-root",
    },
    events: [
      {
        id: "event-1",
        eventType: "tool_call",
        observedAt: "2026-05-01T10:02:00.000Z",
        action: "ran command",
        command: "bun test",
        filesTouched: ["src/dashboard/App.tsx"],
        source: {
          sourceKey: "fixture:codex-local-demo",
          sourceType: "fixture",
          sourceLocator: "fixture/codex-local-demo/session-001/fork-main/0002",
        },
        metadata: {
          toolCalls: 1,
          tokenQuality: "estimated",
        },
        rawPayload: null,
      },
    ],
  };
}

test("server defaults to localhost and answers the health endpoint", async () => {
  const port = await getAvailablePort();
  const server = await startServer({
    port,
    databaseUrl: "postgres://localhost/slopwatch_test",
    collectionRunner: async () => {},
    migrationChecker: {
      check: async () => ({
        status: "ready",
        appliedMigrations: 1,
        expectedMigrations: 1,
      }),
    },
  });

  try {
    expect(server.url).toBe(`http://127.0.0.1:${port}`);

    const response = await fetch(`${server.url}/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      service: "slopwatch",
      status: "ok",
    });
  } finally {
    await server.stop();
  }
});

test("server exposes the shared Now projection through the API", async () => {
  const projection = projectionForAgent("work-unit-1");
  const app = createServerApp({
    nowProvider: async () => projection,
  });

  const response = await app.request("/api/now");

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    generatedAt: "2026-05-01T10:10:00.000Z",
    groups: [
      {
        key: "blocked",
        agents: [],
      },
      {
        key: "active",
        agents: [
          {
            workUnitId: "work-unit-1",
            project: {
              displayName: "slopwatch-demo",
              rootPath: "/projects/slopwatch-demo",
            },
            state: "active",
            activeTimeMs: 240000,
            lastActivityAt: "2026-05-01T10:04:00.000Z",
            lastAction: "reported progress",
            toolCalls: 1,
            tokenQuality: "unavailable",
          },
        ],
      },
      {
        key: "failed",
        agents: [],
      },
      {
        key: "recently_finished",
        agents: [],
      },
    ],
  });
});

test("server exposes recent Projects through the API", async () => {
  const overview = buildProjectsOverview({
    now: new Date("2026-05-01T10:10:00.000Z"),
    records: [
      {
        projectKey: "fixture:/projects/slopwatch-demo",
        project: {
          displayName: "slopwatch-demo",
          rootPath: "/projects/slopwatch-demo",
        },
        workUnitId: "work-unit-1",
        state: "active",
        lastActivityAt: new Date("2026-05-01T10:04:00.000Z"),
      },
    ],
  });
  const app = createServerApp({
    projectsOverviewProvider: async () => overview,
  });

  const response = await app.request("/api/projects/recent");

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    generatedAt: "2026-05-01T10:10:00.000Z",
    projects: [
      {
        projectKey: "fixture:/projects/slopwatch-demo",
        project: {
          displayName: "slopwatch-demo",
          rootPath: "/projects/slopwatch-demo",
        },
        lastActivityAt: "2026-05-01T10:04:00.000Z",
        agentCounts: {
          total: 1,
          active: 1,
          blocked: 0,
          failed: 0,
          finished: 0,
        },
      },
    ],
  });
});

test("server exposes Source health through the API", async () => {
  const app = createServerApp({
    sourcesHealthProvider: async () => ({
      generatedAt: new Date("2026-05-01T10:10:00.000Z"),
      sources: [
        {
          sourceKey: "codex-local:default",
          sourceType: "codex-local",
          path: "/sources/override",
          origin: "configured",
          overridden: true,
          health: { status: "ok" },
          format: { status: "ok" },
        },
      ],
    }),
  });

  const response = await app.request("/api/sources/health");

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    generatedAt: "2026-05-01T10:10:00.000Z",
    sources: [
      {
        sourceKey: "codex-local:default",
        sourceType: "codex-local",
        path: "/sources/override",
        origin: "configured",
        overridden: true,
        health: { status: "ok" },
        format: { status: "ok" },
      },
    ],
  });
});

test("server exposes Agent detail through the API", async () => {
  const app = createServerApp({
    agentDetailProvider: async (workUnitId) =>
      workUnitId === "work-unit-1" ? detailForAgent(workUnitId) : null,
  });

  const response = await app.request("/api/agents/work-unit-1");
  const missing = await app.request("/api/agents/missing-work-unit");

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    workUnitId: "work-unit-1",
    project: {
      displayName: "slopwatch-demo",
    },
    inference: {
      confidence: 0.82,
      explanation: "Derived from recent tool and message Events.",
    },
    forkOrigin: {
      originForkId: "fork-root",
    },
    events: [
      {
        eventType: "tool_call",
        command: "bun test",
        filesTouched: ["src/dashboard/App.tsx"],
        source: {
          sourceLocator: "fixture/codex-local-demo/session-001/fork-main/0002",
        },
      },
    ],
  });
  expect(missing.status).toBe(404);
});

test("server serves the built dashboard and preserves API 404s", async () => {
  const dashboardAssetsPath = await mkdtemp(
    join(tmpdir(), "slopwatch-dashboard-"),
  );
  await mkdir(join(dashboardAssetsPath, "assets"));
  await writeFile(
    join(dashboardAssetsPath, "index.html"),
    "<!doctype html><div id=\"root\"></div>",
  );
  await writeFile(
    join(dashboardAssetsPath, "assets", "dashboard.js"),
    "console.log('dashboard')",
  );
  const app = createServerApp({ dashboardAssetsPath });

  const root = await app.request("/");
  const nestedRoute = await app.request("/agents/work-unit-1");
  const asset = await app.request("/assets/dashboard.js");
  const missingApi = await app.request("/api/missing");

  expect(root.status).toBe(200);
  await expect(root.text()).resolves.toContain("<div id=\"root\"></div>");
  expect(nestedRoute.status).toBe(200);
  await expect(nestedRoute.text()).resolves.toContain("<div id=\"root\"></div>");
  expect(asset.status).toBe(200);
  await expect(asset.text()).resolves.toBe("console.log('dashboard')");
  expect(missingApi.status).toBe(404);
});

test("SSE clients receive a complete Now snapshot on connection", async () => {
  const app = createServerApp({
    nowProvider: async () => projectionForAgent("work-unit-1"),
  });

  const response = await app.request("/api/now/events");

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/event-stream");

  const [event] = await readSseEvents(response, 1);

  expect(event?.event).toBe("now");
  expect(event?.data).toMatchObject({
    generatedAt: "2026-05-01T10:10:00.000Z",
    groups: [
      {
        key: "blocked",
        agents: [],
      },
      {
        key: "active",
        agents: [
          {
            workUnitId: "work-unit-1",
            project: {
              displayName: "slopwatch-demo",
              rootPath: "/projects/slopwatch-demo",
            },
            state: "active",
            lastAction: "reported progress",
          },
        ],
      },
      {
        key: "failed",
        agents: [],
      },
      {
        key: "recently_finished",
        agents: [],
      },
    ],
  });
});

test("SSE clients receive coalesced Now updates after relevant changes", async () => {
  const nowUpdates = createNowUpdateBus({ coalesceMs: 0 });
  const projections = [
    projectionForAgent("initial-work-unit"),
    projectionForAgent("updated-work-unit"),
  ];
  let providerCalls = 0;
  const app = createServerApp({
    nowUpdates,
    nowProvider: async () => {
      const projection =
        projections[Math.min(providerCalls, projections.length - 1)];
      providerCalls += 1;

      if (!projection) {
        throw new Error("Expected projection fixture.");
      }

      return projection;
    },
  });

  const response = await app.request("/api/now/events");
  const eventsPromise = readSseEvents(response, 2);

  await Bun.sleep(0);
  nowUpdates.publish();
  nowUpdates.publish();

  const events = await eventsPromise;

  expect(
    events.map((event) =>
      event.data &&
      typeof event.data === "object" &&
      "groups" in event.data
        ? (
            event.data as {
              groups: Array<{ key: string; agents: Array<{ workUnitId: string }> }>;
            }
          ).groups
            .find((group) => group.key === "active")
            ?.agents.map((agent) => agent.workUnitId)
        : [],
    ),
  ).toEqual([["initial-work-unit"], ["updated-work-unit"]]);

  await Bun.sleep(10);
  expect(providerCalls).toBe(2);
});

test("server performs initial collection only after database health passes", async () => {
  const port = await getAvailablePort();
  const calls: string[] = [];
  const server = await startServer({
    host: "127.0.0.1",
    port,
    databaseUrl: "postgres://localhost/slopwatch_test",
    collectionRunner: async ({ config }) => {
      calls.push(`collect:${config.databaseUrl}`);
    },
    migrationChecker: {
      check: async () => {
        calls.push("health");

        return {
          status: "ready",
          appliedMigrations: 1,
          expectedMigrations: 1,
        };
      },
    },
  });

  try {
    expect(calls).toEqual([
      "health",
      "collect:postgres://localhost/slopwatch_test",
    ]);
  } finally {
    await server.stop();
  }
});

test("server polls lightly while running and pushes Now updates", async () => {
  const port = await getAvailablePort();
  let collectionRuns = 0;
  const server = await startServer({
    host: "127.0.0.1",
    port,
    databaseUrl: "postgres://localhost/slopwatch_test",
    collectionRunner: async () => {
      collectionRuns += 1;
    },
    migrationChecker: {
      check: async () => ({
        status: "ready",
        appliedMigrations: 1,
        expectedMigrations: 1,
      }),
    },
    nowProvider: async () =>
      projectionForAgent(
        collectionRuns > 1 ? "poll-updated-work-unit" : "initial-work-unit",
      ),
    pollIntervalMs: 5,
  });

  try {
    const response = await fetch(`${server.url}/api/now/events`);
    const events = await withTimeout(readSseEvents(response, 2), 500);

    expect(
      events.map((event) =>
        event.data &&
        typeof event.data === "object" &&
        "groups" in event.data
          ? (
              event.data as {
                groups: Array<{
                  key: string;
                  agents: Array<{ workUnitId: string }>;
                }>;
              }
            ).groups
              .find((group) => group.key === "active")
              ?.agents.map((agent) => agent.workUnitId)
          : [],
      ),
    ).toEqual([["initial-work-unit"], ["poll-updated-work-unit"]]);
    expect(collectionRuns).toBeGreaterThanOrEqual(2);
  } finally {
    await server.stop();
  }
});

test("server refuses to start when database migrations are pending", async () => {
  const port = await getAvailablePort();
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  let collected = false;
  const options = {
    host: "127.0.0.1",
    port,
    databaseUrl: "postgres://localhost/slopwatch_test",
    collectionRunner: async () => {
      collected = true;
    },
    migrationChecker: {
      check: async () => ({
        status: "pending" as const,
        appliedMigrations: 0,
        expectedMigrations: 1,
      }),
    },
  } as Parameters<typeof startServer>[0] & {
    migrationChecker: {
      check: () => Promise<{
        status: "pending";
        appliedMigrations: number;
        expectedMigrations: number;
      }>;
    };
  };

  try {
    await expect(
      (async () => {
        server = await startServer(options);
      })(),
    ).rejects.toThrow("Run slopwatch db migrate");
    expect(collected).toBe(false);
  } finally {
    await server?.stop();
  }
});
