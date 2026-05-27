import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";

import {
  DashboardRoutes,
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
  expect(markup).not.toContain("/projects/slopwatch-demo");
});
