import { describe, expect, test } from "bun:test";

import {
  buildNowProjection,
  createNowProjectionProvider,
  getNowProjection,
  type NowProjectionSourceRecord,
  type NowProjectionStore,
} from "../src/now/projection";
import { runNowStatus } from "../src/now/status";
import { createServerApp } from "../src/server/app";

function sourceRecord(
  overrides: Partial<NowProjectionSourceRecord> & {
    workUnitId: string;
    state: NowProjectionSourceRecord["state"];
    lastActivityAt: Date;
  },
): NowProjectionSourceRecord {
  return {
    workUnitId: overrides.workUnitId,
    project: {
      displayName: `${overrides.workUnitId} project`,
      rootPath: `/projects/${overrides.workUnitId}`,
    },
    state: overrides.state,
    activeTimeMs: overrides.activeTimeMs ?? 0,
    confidence: overrides.confidence ?? 0.9,
    explanation: overrides.explanation ?? "calculated by inference",
    lastActivityAt: overrides.lastActivityAt,
    lastAction: overrides.lastAction ?? "reported progress",
    toolCalls: overrides.toolCalls ?? 0,
    tokenQuality: overrides.tokenQuality ?? "unavailable",
  };
}

describe("Now projection", () => {
  test("groups Agents by actionability and orders Agents by last activity", () => {
    const projection = buildNowProjection({
      now: new Date("2026-05-01T10:10:00.000Z"),
      records: [
        sourceRecord({
          workUnitId: "active-older",
          state: "active",
          lastActivityAt: new Date("2026-05-01T10:01:00.000Z"),
        }),
        sourceRecord({
          workUnitId: "failed",
          state: "failed",
          lastActivityAt: new Date("2026-05-01T10:04:00.000Z"),
        }),
        sourceRecord({
          workUnitId: "blocked",
          state: "blocked",
          lastActivityAt: new Date("2026-05-01T10:02:00.000Z"),
        }),
        sourceRecord({
          workUnitId: "active-newer",
          state: "active",
          lastActivityAt: new Date("2026-05-01T10:05:00.000Z"),
        }),
      ],
    });

    expect(projection.groups.map((group) => group.key)).toEqual([
      "blocked",
      "active",
      "failed",
      "recently_finished",
    ]);
    expect(
      projection.groups.find((group) => group.key === "active")?.agents.map(
        (agent) => agent.workUnitId,
      ),
    ).toEqual(["active-newer", "active-older"]);
  });

  test("derives Recently finished from Finished WorkUnits inside the recency window", () => {
    const projection = buildNowProjection({
      now: new Date("2026-05-01T10:30:00.000Z"),
      recentlyFinishedWindowMs: 30 * 60 * 1000,
      records: [
        sourceRecord({
          workUnitId: "recent-finished",
          state: "finished",
          lastActivityAt: new Date("2026-05-01T10:05:00.000Z"),
        }),
        sourceRecord({
          workUnitId: "old-finished",
          state: "finished",
          lastActivityAt: new Date("2026-05-01T09:50:00.000Z"),
        }),
      ],
    });

    expect(
      projection.groups
        .find((group) => group.key === "recently_finished")
        ?.agents.map((agent) => agent.workUnitId),
    ).toEqual(["recent-finished"]);
  });

  test("keeps confidence and explanation out of main Agent cards", () => {
    const projection = buildNowProjection({
      now: new Date("2026-05-01T10:10:00.000Z"),
      records: [
        sourceRecord({
          workUnitId: "active",
          state: "active",
          confidence: 0.71,
          explanation: "This detail belongs on the Agent detail view.",
          lastActivityAt: new Date("2026-05-01T10:05:00.000Z"),
        }),
      ],
    });

    const [agent] =
      projection.groups.find((group) => group.key === "active")?.agents ?? [];

    expect(agent).toEqual({
      workUnitId: "active",
      project: {
        displayName: "active project",
        rootPath: "/projects/active",
      },
      state: "active",
      activeTimeMs: 0,
      lastActivityAt: new Date("2026-05-01T10:05:00.000Z"),
      lastAction: "reported progress",
      toolCalls: 0,
      tokenQuality: "unavailable",
    });
    expect(agent).not.toHaveProperty("confidence");
    expect(agent).not.toHaveProperty("explanation");
  });

  test("reads the shared Now projection through the store boundary", async () => {
    const store: NowProjectionStore = {
      listNowProjectionRecords: async () => [
        sourceRecord({
          workUnitId: "blocked",
          state: "blocked",
          lastActivityAt: new Date("2026-05-01T10:05:00.000Z"),
        }),
      ],
    };

    const projection = await getNowProjection({
      store,
      now: new Date("2026-05-01T10:10:00.000Z"),
    });

    expect(
      projection.groups.find((group) => group.key === "blocked")?.agents[0]
        ?.workUnitId,
    ).toBe("blocked");
  });

  test("provider resolves the projection and closes the store", async () => {
    let closed = false;
    const provider = createNowProjectionProvider({
      databaseUrl: "postgres://localhost/slopwatch_test",
      now: () => new Date("2026-05-01T10:10:00.000Z"),
      storeFactory: () => ({
        listNowProjectionRecords: async () => [
          sourceRecord({
            workUnitId: "active",
            state: "active",
            lastActivityAt: new Date("2026-05-01T10:05:00.000Z"),
          }),
        ],
        close: async () => {
          closed = true;
        },
      }),
    });

    const projection = await provider();

    expect(
      projection.groups.find((group) => group.key === "active")?.agents[0]
        ?.workUnitId,
    ).toBe("active");
    expect(closed).toBe(true);
  });

  test("API and status consume the same Now projection provider contract", async () => {
    const projection = buildNowProjection({
      now: new Date("2026-05-01T10:10:00.000Z"),
      records: [
        sourceRecord({
          workUnitId: "active",
          state: "active",
          lastActivityAt: new Date("2026-05-01T10:05:00.000Z"),
        }),
      ],
    });
    const nowProvider = async () => projection;
    const app = createServerApp({ nowProvider });
    const lines: string[] = [];

    const response = await app.request("/api/now");
    await runNowStatus({
      nowProvider,
      writeLine: (line) => {
        lines.push(line);
      },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      groups: Array<{
        key: string;
        agents: Array<{
          workUnitId: string;
          project: {
            displayName: string;
            rootPath: string;
          };
        }>;
      }>;
    };
    const activeGroup = body.groups.find(
      (group: { key: string }) => group.key === "active",
    );

    if (!activeGroup) {
      throw new Error("Expected active group in Now API response.");
    }

    expect(activeGroup.agents[0]).toMatchObject({
      workUnitId: "active",
      project: {
        displayName: "active project",
        rootPath: "/projects/active",
      },
    });
    expect(lines.join("\n")).toContain("active project");
  });

  test("API and status show waiting Agents in the Blocked group", async () => {
    const projection = buildNowProjection({
      now: new Date("2026-05-01T10:10:00.000Z"),
      records: [
        sourceRecord({
          workUnitId: "blocked",
          state: "blocked",
          lastActivityAt: new Date("2026-05-01T10:05:00.000Z"),
          lastAction: "waiting for approval",
        }),
      ],
    });
    const nowProvider = async () => projection;
    const app = createServerApp({ nowProvider });
    const lines: string[] = [];

    const response = await app.request("/api/now");
    await runNowStatus({
      nowProvider,
      writeLine: (line) => {
        lines.push(line);
      },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      groups: Array<{
        key: string;
        agents: Array<{
          workUnitId: string;
          state: string;
          lastAction?: string;
        }>;
      }>;
    };
    const blockedGroup = body.groups.find((group) => group.key === "blocked");

    expect(blockedGroup?.agents).toEqual([
      expect.objectContaining({
        workUnitId: "blocked",
        state: "blocked",
        lastAction: "waiting for approval",
      }),
    ]);
    expect(lines.join("\n")).toContain("Blocked");
    expect(lines.join("\n")).toContain("waiting for approval");
  });

  test("API and status show terminally failed Agents in the Failed group", async () => {
    const projection = buildNowProjection({
      now: new Date("2026-05-01T10:10:00.000Z"),
      records: [
        sourceRecord({
          workUnitId: "failed",
          state: "failed",
          lastActivityAt: new Date("2026-05-01T10:05:00.000Z"),
          lastAction: "reported terminal failure",
        }),
      ],
    });
    const nowProvider = async () => projection;
    const app = createServerApp({ nowProvider });
    const lines: string[] = [];

    const response = await app.request("/api/now");
    await runNowStatus({
      nowProvider,
      writeLine: (line) => {
        lines.push(line);
      },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      groups: Array<{
        key: string;
        agents: Array<{
          workUnitId: string;
          state: string;
          lastAction?: string;
        }>;
      }>;
    };
    const failedGroup = body.groups.find((group) => group.key === "failed");

    expect(failedGroup?.agents).toEqual([
      expect.objectContaining({
        workUnitId: "failed",
        state: "failed",
        lastAction: "reported terminal failure",
      }),
    ]);
    expect(lines.join("\n")).toContain("Failed");
    expect(lines.join("\n")).toContain("reported terminal failure");
  });

  test("API and status show recently Finished Agents in the Recently finished group", async () => {
    const projection = buildNowProjection({
      now: new Date("2026-05-01T10:10:00.000Z"),
      recentlyFinishedWindowMs: 30 * 60 * 1000,
      records: [
        sourceRecord({
          workUnitId: "finished",
          state: "finished",
          lastActivityAt: new Date("2026-05-01T10:05:00.000Z"),
          lastAction: "completed task",
        }),
      ],
    });
    const nowProvider = async () => projection;
    const app = createServerApp({ nowProvider });
    const lines: string[] = [];

    const response = await app.request("/api/now");
    await runNowStatus({
      nowProvider,
      writeLine: (line) => {
        lines.push(line);
      },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      groups: Array<{
        key: string;
        agents: Array<{
          workUnitId: string;
          state: string;
          lastAction?: string;
        }>;
      }>;
    };
    const recentlyFinishedGroup = body.groups.find(
      (group) => group.key === "recently_finished",
    );

    expect(recentlyFinishedGroup?.agents).toEqual([
      expect.objectContaining({
        workUnitId: "finished",
        state: "finished",
        lastAction: "completed task",
      }),
    ]);
    expect(lines.join("\n")).toContain("Recently finished");
    expect(lines.join("\n")).toContain("completed task");
  });
});
