import { describe, expect, test } from "bun:test";

import {
  buildProjectsOverview,
  createProjectsOverviewProvider,
  getProjectsOverview,
  type ProjectActivityRecord,
  type ProjectsOverviewStore,
} from "../src/projects/overview";

function activityRecord(
  overrides: Partial<ProjectActivityRecord> & {
    projectKey: string;
    workUnitId: string;
    state: ProjectActivityRecord["state"];
    lastActivityAt: Date;
  },
): ProjectActivityRecord {
  return {
    projectKey: overrides.projectKey,
    project: overrides.project ?? {
      displayName: overrides.projectKey.replace("fixture:", ""),
      rootPath: overrides.projectKey.replace("fixture:", ""),
    },
    workUnitId: overrides.workUnitId,
    state: overrides.state,
    lastActivityAt: overrides.lastActivityAt,
  };
}

describe("Projects overview", () => {
  test("lists recent Projects with last activity and Agent counts", () => {
    const overview = buildProjectsOverview({
      now: new Date("2026-05-01T10:10:00.000Z"),
      records: [
        activityRecord({
          projectKey: "fixture:/projects/older",
          workUnitId: "older-active",
          state: "active",
          lastActivityAt: new Date("2026-05-01T10:01:00.000Z"),
        }),
        activityRecord({
          projectKey: "fixture:/projects/slopwatch-demo",
          workUnitId: "demo-active",
          state: "active",
          lastActivityAt: new Date("2026-05-01T10:04:00.000Z"),
        }),
        activityRecord({
          projectKey: "fixture:/projects/slopwatch-demo",
          workUnitId: "demo-blocked",
          state: "blocked",
          lastActivityAt: new Date("2026-05-01T10:02:00.000Z"),
        }),
        activityRecord({
          projectKey: "fixture:/projects/slopwatch-demo",
          workUnitId: "demo-finished",
          state: "finished",
          lastActivityAt: new Date("2026-05-01T09:59:00.000Z"),
        }),
      ],
    });

    expect(overview.generatedAt).toEqual(new Date("2026-05-01T10:10:00.000Z"));
    expect(overview.projects.map((project) => project.projectKey)).toEqual([
      "fixture:/projects/slopwatch-demo",
      "fixture:/projects/older",
    ]);
    expect(overview.projects[0]).toEqual({
      projectKey: "fixture:/projects/slopwatch-demo",
      project: {
        displayName: "/projects/slopwatch-demo",
        rootPath: "/projects/slopwatch-demo",
      },
      lastActivityAt: new Date("2026-05-01T10:04:00.000Z"),
      agentCounts: {
        total: 3,
        active: 1,
        blocked: 1,
        failed: 0,
        finished: 1,
      },
    });
  });

  test("reads the overview through the store boundary and closes the store", async () => {
    let closed = false;
    const store: ProjectsOverviewStore & { close: () => Promise<void> } = {
      listProjectActivityRecords: async () => [
        activityRecord({
          projectKey: "fixture:/projects/slopwatch-demo",
          workUnitId: "demo-active",
          state: "active",
          lastActivityAt: new Date("2026-05-01T10:04:00.000Z"),
        }),
      ],
      close: async () => {
        closed = true;
      },
    };

    const overview = await getProjectsOverview({
      store,
      now: new Date("2026-05-01T10:10:00.000Z"),
    });
    const provider = createProjectsOverviewProvider({
      databaseUrl: "postgres://localhost/slopwatch_test",
      now: () => new Date("2026-05-01T10:10:00.000Z"),
      storeFactory: () => store,
    });

    expect(overview.projects[0]?.projectKey).toBe(
      "fixture:/projects/slopwatch-demo",
    );
    await provider();
    expect(closed).toBe(true);
  });
});
