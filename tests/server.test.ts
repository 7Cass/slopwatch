import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildNowProjection } from "../src/now/projection";
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

test("server starts on localhost and answers the health endpoint", async () => {
  const port = await getAvailablePort();
  const server = await startServer({
    host: "127.0.0.1",
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
