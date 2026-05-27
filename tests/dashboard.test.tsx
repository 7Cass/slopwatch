import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";

import {
  DashboardRoutes,
  type SerializedAgentDetail,
  type SerializedNowProjection,
} from "../src/dashboard/App";

const nowFixture: SerializedNowProjection = {
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
          toolCalls: 3,
          tokenQuality: "estimated",
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
};

const agentDetailFixture: SerializedAgentDetail = {
  workUnitId: "work-unit-1",
  project: {
    displayName: "slopwatch-demo",
    rootPath: "/projects/slopwatch-demo",
  },
  state: "active",
  activeTimeMs: 240000,
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
        totalTokens: 42,
      },
      rawPayload: null,
    },
    {
      id: "event-2",
      eventType: "error",
      observedAt: "2026-05-01T10:04:00.000Z",
      action: "reported error",
      error: "terminal failure",
      filesTouched: [],
      source: {
        sourceKey: "fixture:codex-local-demo",
        sourceType: "fixture",
        sourceLocator: "fixture/codex-local-demo/session-001/fork-main/0003",
      },
      metadata: {
        status: "failed",
      },
      rawPayload: "full assistant response text",
    },
  ],
};

test("Now screen renders a fixture-backed Agent card", () => {
  const markup = renderToStaticMarkup(
    <StaticRouter location="/">
      <DashboardRoutes initialProjection={nowFixture} />
    </StaticRouter>,
  );

  expect(markup).toContain("slopwatch-demo");
  expect(markup).toContain("Active");
  expect(markup).toContain("reported progress");
  expect(markup).toContain("4m active");
  expect(markup).toContain("3 tool calls");
  expect(markup).toContain("estimated tokens");
  expect(markup).toContain('href="/agents/work-unit-1"');
  expect(markup).not.toContain("/projects/slopwatch-demo");
});

test("Agent detail route renders timeline metadata and keeps Raw payload hidden by default", () => {
  const markup = renderToStaticMarkup(
    <StaticRouter location="/agents/work-unit-1">
      <DashboardRoutes
        initialProjection={nowFixture}
        initialAgentDetails={[agentDetailFixture]}
      />
    </StaticRouter>,
  );

  expect(markup).toContain("Agent detail");
  expect(markup).toContain("slopwatch-demo");
  expect(markup).toContain("Timeline");
  expect(markup).toContain("ran command");
  expect(markup).toContain("bun test");
  expect(markup).toContain("src/dashboard/App.tsx");
  expect(markup).toContain("terminal failure");
  expect(markup).toContain(
    "fixture/codex-local-demo/session-001/fork-main/0002",
  );
  expect(markup).toContain("82% confidence");
  expect(markup).toContain("Derived from recent tool and message Events.");
  expect(markup).toContain("Fork origin");
  expect(markup).toContain("fork-root");
  expect(markup).toContain("estimated");
  expect(markup).toContain("42");
  expect(markup).toContain("Show Raw payload");
  expect(markup).not.toContain("full assistant response text");
});
