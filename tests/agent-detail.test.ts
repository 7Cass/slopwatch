import { describe, expect, test } from "bun:test";

import {
  createAgentDetailProvider,
  getAgentDetail,
  type AgentDetailRecord,
  type AgentDetailStore,
} from "../src/agents/detail";

const detailRecord: AgentDetailRecord = {
  workUnitId: "work-unit-1",
  project: {
    displayName: "slopwatch-demo",
    rootPath: "/projects/slopwatch-demo",
  },
  state: "active",
  activeTimeMs: 4 * 60 * 1000,
  lastActivityAt: new Date("2026-05-01T10:04:00.000Z"),
  inference: {
    confidence: 0.82,
    explanation: "Derived from recent tool and message Events.",
    inferenceVersion: "work-unit-inference-v1",
    calculatedAt: new Date("2026-05-01T10:05:00.000Z"),
  },
  forkOrigin: {
    sourceForkId: "fork-main",
    originForkId: "fork-root",
  },
  events: [
    {
      id: "event-2",
      eventType: "error",
      observedAt: new Date("2026-05-01T10:04:00.000Z"),
      source: {
        sourceKey: "fixture:codex-local-demo",
        sourceType: "fixture",
        sourceLocator: "fixture/codex-local-demo/session-001/fork-main/0003",
      },
      metadata: {
        status: "failed",
        message: "terminal failure",
      },
      rawPayload: "full assistant response text",
    },
    {
      id: "event-1",
      eventType: "tool_call",
      observedAt: new Date("2026-05-01T10:02:00.000Z"),
      source: {
        sourceKey: "fixture:codex-local-demo",
        sourceType: "fixture",
        sourceLocator: "fixture/codex-local-demo/session-001/fork-main/0002",
      },
      metadata: {
        action: "ran command",
        command: "bun test",
        filePath: "src/dashboard/App.tsx",
        tokenQuality: "estimated",
      },
      rawPayload: null,
    },
  ],
};

class InMemoryAgentDetailStore implements AgentDetailStore {
  closed = false;

  constructor(private readonly record: AgentDetailRecord | null) {}

  async getAgentDetailRecord() {
    return this.record;
  }

  async close() {
    this.closed = true;
  }
}

describe("Agent detail", () => {
  test("builds timeline detail from WorkUnit Events through the store boundary", async () => {
    const detail = await getAgentDetail({
      store: new InMemoryAgentDetailStore(detailRecord),
      workUnitId: "work-unit-1",
    });

    expect(detail).toMatchObject({
      workUnitId: "work-unit-1",
      project: {
        displayName: "slopwatch-demo",
      },
      inference: {
        confidence: 0.82,
        explanation: "Derived from recent tool and message Events.",
      },
      forkOrigin: {
        sourceForkId: "fork-main",
        originForkId: "fork-root",
      },
    });
    expect(detail?.events.map((event) => event.id)).toEqual([
      "event-1",
      "event-2",
    ]);
    expect(detail?.events[0]).toMatchObject({
      action: "ran command",
      command: "bun test",
      filesTouched: ["src/dashboard/App.tsx"],
      source: {
        sourceLocator: "fixture/codex-local-demo/session-001/fork-main/0002",
      },
    });
    expect(detail?.events[1]).toMatchObject({
      error: "terminal failure",
      rawPayload: "full assistant response text",
    });
  });

  test("provider resolves missing details and closes the store", async () => {
    const store = new InMemoryAgentDetailStore(null);
    const provider = createAgentDetailProvider({
      databaseUrl: "postgres://localhost/slopwatch_test",
      storeFactory: () => store,
    });

    await expect(provider("missing-work-unit")).resolves.toBeNull();
    expect(store.closed).toBe(true);
  });
});
