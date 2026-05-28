import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";

import {
  DashboardRoutes,
  type SerializedAgentDetail,
  type SerializedNowProjection,
  type SerializedProjectsOverview,
  type SerializedSourcesHealth,
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

const blockedNowFixture: SerializedNowProjection = {
  generatedAt: "2026-05-01T10:10:00.000Z",
  groups: [
    {
      key: "blocked",
      agents: [
        {
          workUnitId: "work-unit-blocked",
          project: {
            displayName: "slopwatch-demo",
            rootPath: "/projects/slopwatch-demo",
          },
          state: "blocked",
          activeTimeMs: 240000,
          lastActivityAt: "2026-05-01T10:04:00.000Z",
          lastAction: "waiting for approval",
          toolCalls: 1,
          tokenQuality: "unavailable",
        },
      ],
    },
    {
      key: "active",
      agents: [],
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

const failedNowFixture: SerializedNowProjection = {
  generatedAt: "2026-05-01T10:10:00.000Z",
  groups: [
    {
      key: "blocked",
      agents: [],
    },
    {
      key: "active",
      agents: [],
    },
    {
      key: "failed",
      agents: [
        {
          workUnitId: "work-unit-failed",
          project: {
            displayName: "slopwatch-demo",
            rootPath: "/projects/slopwatch-demo",
          },
          state: "failed",
          activeTimeMs: 240000,
          lastActivityAt: "2026-05-01T10:04:00.000Z",
          lastAction: "reported terminal failure",
          toolCalls: 1,
          tokenQuality: "unavailable",
        },
      ],
    },
    {
      key: "recently_finished",
      agents: [],
    },
  ],
};

const finishedNowFixture: SerializedNowProjection = {
  generatedAt: "2026-05-01T10:10:00.000Z",
  groups: [
    {
      key: "blocked",
      agents: [],
    },
    {
      key: "active",
      agents: [],
    },
    {
      key: "failed",
      agents: [],
    },
    {
      key: "recently_finished",
      agents: [
        {
          workUnitId: "work-unit-finished",
          project: {
            displayName: "slopwatch-demo",
            rootPath: "/projects/slopwatch-demo",
          },
          state: "finished",
          activeTimeMs: 240000,
          lastActivityAt: "2026-05-01T10:04:00.000Z",
          lastAction: "completed task",
          toolCalls: 1,
          tokenQuality: "unavailable",
        },
      ],
    },
  ],
};

const failedAgentDetailFixture: SerializedAgentDetail = {
  workUnitId: "work-unit-failed",
  project: {
    displayName: "slopwatch-demo",
    rootPath: "/projects/slopwatch-demo",
  },
  state: "failed",
  activeTimeMs: 240000,
  lastActivityAt: "2026-05-01T10:04:00.000Z",
  inference: {
    confidence: 0.9,
    explanation: "Failed because the final Event has terminal failure evidence.",
    inferenceVersion: "work-unit-inference-v1",
    calculatedAt: "2026-05-01T10:05:00.000Z",
  },
  events: [
    {
      id: "event-failed",
      eventType: "error",
      observedAt: "2026-05-01T10:04:00.000Z",
      action: "reported terminal failure",
      error: "Codex run failed before producing a final response.",
      filesTouched: [],
      source: {
        sourceKey: "codex-local:default",
        sourceType: "codex-local",
        sourceLocator: "sessions/2026/05/27/rollout-thread-main.jsonl:4",
        path: "/sources/configured-codex",
      },
      metadata: {
        status: "failed",
        terminal: true,
        message: "Codex run failed before producing a final response.",
      },
      rawPayload: null,
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
    originStatus: "resolved",
    originWorkUnitId: "work-unit-root",
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

const unresolvedOriginAgentDetailFixture: SerializedAgentDetail = {
  ...agentDetailFixture,
  workUnitId: "work-unit-child-unresolved",
  forkOrigin: {
    sourceForkId: "thread-child",
    originForkId: "thread-parent",
    originStatus: "unresolved",
    originWorkUnitId: null,
  },
};

const projectsFixture: SerializedProjectsOverview = {
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
        total: 3,
        active: 1,
        blocked: 1,
        failed: 0,
        finished: 1,
      },
    },
  ],
};

const sourcesFixture: SerializedSourcesHealth = {
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
    {
      sourceKey: "codex-local:missing",
      sourceType: "codex-local",
      path: "/sources/missing",
      origin: "configured",
      overridden: false,
      health: {
        status: "missing",
        message: "Source path does not exist.",
      },
      format: {
        status: "missing",
        message: "Source path does not exist.",
      },
    },
    {
      sourceKey: "codex-local:detected",
      sourceType: "codex-local",
      path: "/sources/detected",
      origin: "detected",
      overridden: false,
      health: { status: "ok" },
      format: {
        status: "malformed",
        message:
          "Codex local Source must contain state_5.sqlite and sessions/YYYY/MM/DD/rollout-*.jsonl.",
      },
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

test("Now screen renders waiting Agents in the Blocked group", () => {
  const markup = renderToStaticMarkup(
    <StaticRouter location="/">
      <DashboardRoutes initialProjection={blockedNowFixture} />
    </StaticRouter>,
  );

  expect(markup).toContain("Blocked");
  expect(markup).toContain("slopwatch-demo");
  expect(markup).toContain("waiting for approval");
  expect(markup).toContain('href="/agents/work-unit-blocked"');
});

test("Now screen renders terminally failed Agents in the Failed group", () => {
  const markup = renderToStaticMarkup(
    <StaticRouter location="/">
      <DashboardRoutes initialProjection={failedNowFixture} />
    </StaticRouter>,
  );

  expect(markup).toContain("Failed");
  expect(markup).toContain("Needs attention");
  expect(markup).toContain("slopwatch-demo");
  expect(markup).toContain("reported terminal failure");
  expect(markup).toContain('href="/agents/work-unit-failed"');
});

test("Now screen renders recently Finished Agents in the Recently finished group", () => {
  const markup = renderToStaticMarkup(
    <StaticRouter location="/">
      <DashboardRoutes initialProjection={finishedNowFixture} />
    </StaticRouter>,
  );

  expect(markup).toContain("Recently finished");
  expect(markup).toContain("Completed in the recent window");
  expect(markup).toContain("slopwatch-demo");
  expect(markup).toContain("completed task");
  expect(markup).toContain('href="/agents/work-unit-finished"');
});

test("Agent detail route renders Failed inference and terminal failure Event", () => {
  const markup = renderToStaticMarkup(
    <StaticRouter location="/agents/work-unit-failed">
      <DashboardRoutes
        initialProjection={failedNowFixture}
        initialAgentDetails={[failedAgentDetailFixture]}
      />
    </StaticRouter>,
  );

  expect(markup).toContain("Failed");
  expect(markup).toContain(
    "Failed because the final Event has terminal failure evidence.",
  );
  expect(markup).toContain("reported terminal failure");
  expect(markup).toContain(
    "Codex run failed before producing a final response.",
  );
  expect(markup).toContain(
    "sessions/2026/05/27/rollout-thread-main.jsonl:4",
  );
});

test("Projects route renders recent Projects and links to filtered Agent activity", () => {
  const markup = renderToStaticMarkup(
    <StaticRouter location="/projects">
      <DashboardRoutes
        initialProjection={nowFixture}
        initialProjects={projectsFixture}
      />
    </StaticRouter>,
  );

  expect(markup).toContain("Projects");
  expect(markup).toContain("Sources");
  expect(markup).toContain("slopwatch-demo");
  expect(markup).toContain("/projects/slopwatch-demo");
  expect(markup).toContain("3 Agents");
  expect(markup).toContain("1 Active");
  expect(markup).toContain("1 Blocked");
  expect(markup).toContain("1 Finished");
  expect(markup).toContain('href="/?project=%2Fprojects%2Fslopwatch-demo"');
});

test("Sources route renders detected and overridden Source health", () => {
  const markup = renderToStaticMarkup(
    <StaticRouter location="/sources">
      <DashboardRoutes initialSources={sourcesFixture} />
    </StaticRouter>,
  );

  expect(markup).toContain("Sources");
  expect(markup).toContain("Now");
  expect(markup).toContain("Projects");
  expect(markup).toContain("codex-local:default");
  expect(markup).toContain("/sources/override");
  expect(markup).toContain("configured");
  expect(markup).toContain("override");
  expect(markup).toContain("codex-local:detected");
  expect(markup).toContain("detected");
  expect(markup).toContain("ok");
  expect(markup).toContain("missing");
  expect(markup).toContain("malformed");
  expect(markup).toContain("Source path does not exist.");
  expect(markup).toContain(
    "Codex local Source must contain state_5.sqlite and sessions/YYYY/MM/DD/rollout-*.jsonl.",
  );
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
  expect(markup).toContain("Linked");
  expect(markup).toContain('href="/agents/work-unit-root"');
  expect(markup).toContain("estimated");
  expect(markup).toContain("42");
  expect(markup).toContain("Show Raw payload");
  expect(markup).not.toContain("full assistant response text");
});

test("Agent detail route renders unresolved Fork origin information without an origin Agent link", () => {
  const markup = renderToStaticMarkup(
    <StaticRouter location="/agents/work-unit-child-unresolved">
      <DashboardRoutes
        initialProjection={nowFixture}
        initialAgentDetails={[unresolvedOriginAgentDetailFixture]}
      />
    </StaticRouter>,
  );

  expect(markup).toContain("Fork origin");
  expect(markup).toContain("thread-child");
  expect(markup).toContain("thread-parent");
  expect(markup).toContain("Unresolved");
  expect(markup).not.toContain('href="/agents/thread-parent"');
});
