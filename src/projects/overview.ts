import type { WorkUnitState } from "../infer/work-unit";

export type ProjectActivityRecord = {
  projectKey: string;
  project: {
    displayName: string;
    rootPath: string;
  };
  workUnitId: string;
  state: WorkUnitState;
  lastActivityAt: Date;
};

export type ProjectAgentCounts = Record<WorkUnitState, number> & {
  total: number;
};

export type ProjectOverviewItem = {
  projectKey: string;
  project: {
    displayName: string;
    rootPath: string;
  };
  lastActivityAt: Date;
  agentCounts: ProjectAgentCounts;
};

export type ProjectsOverview = {
  generatedAt: Date;
  projects: ProjectOverviewItem[];
};

export type ProjectsOverviewStore = {
  listProjectActivityRecords: () => Promise<ProjectActivityRecord[]>;
};

export type CloseableProjectsOverviewStore = ProjectsOverviewStore & {
  close?: () => Promise<void>;
};

export type ProjectsOverviewProvider = () => Promise<ProjectsOverview>;

export type ProjectsOverviewStoreFactory = (
  databaseUrl: string,
) => CloseableProjectsOverviewStore;

export const defaultProjectsOverviewLimit = 10;

export async function getProjectsOverview({
  store,
  now = new Date(),
  limit = defaultProjectsOverviewLimit,
}: {
  store: ProjectsOverviewStore;
  now?: Date;
  limit?: number;
}): Promise<ProjectsOverview> {
  return buildProjectsOverview({
    now,
    limit,
    records: await store.listProjectActivityRecords(),
  });
}

export function createProjectsOverviewProvider({
  databaseUrl,
  storeFactory,
  now = () => new Date(),
  limit = defaultProjectsOverviewLimit,
}: {
  databaseUrl: string;
  storeFactory: ProjectsOverviewStoreFactory;
  now?: () => Date;
  limit?: number;
}): ProjectsOverviewProvider {
  return async () => {
    const store = storeFactory(databaseUrl);

    try {
      return await getProjectsOverview({
        store,
        now: now(),
        limit,
      });
    } finally {
      await store.close?.();
    }
  };
}

export function buildProjectsOverview({
  now = new Date(),
  limit = defaultProjectsOverviewLimit,
  records,
}: {
  now?: Date;
  limit?: number;
  records: ProjectActivityRecord[];
}): ProjectsOverview {
  const projects = new Map<string, ProjectOverviewItem>();

  for (const record of records) {
    const existing = projects.get(record.projectKey);
    const project =
      existing ??
      ({
        projectKey: record.projectKey,
        project: record.project,
        lastActivityAt: record.lastActivityAt,
        agentCounts: {
          total: 0,
          active: 0,
          blocked: 0,
          failed: 0,
          finished: 0,
        },
      } satisfies ProjectOverviewItem);

    project.agentCounts.total += 1;
    project.agentCounts[record.state] += 1;

    if (record.lastActivityAt > project.lastActivityAt) {
      project.lastActivityAt = record.lastActivityAt;
    }

    projects.set(record.projectKey, project);
  }

  return {
    generatedAt: now,
    projects: [...projects.values()]
      .sort(
        (left, right) =>
          right.lastActivityAt.getTime() - left.lastActivityAt.getTime(),
      )
      .slice(0, limit),
  };
}
