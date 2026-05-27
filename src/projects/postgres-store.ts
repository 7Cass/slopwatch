import { desc, eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";

import { inferences, projects, workUnits } from "../db/schema";
import type { ProjectActivityRecord, ProjectsOverviewStore } from "./overview";

export class PostgresProjectsOverviewStore implements ProjectsOverviewStore {
  constructor(
    private readonly database: PostgresJsDatabase,
    private readonly client?: Sql,
  ) {}

  async listProjectActivityRecords(): Promise<ProjectActivityRecord[]> {
    const rows = await this.database
      .select({
        projectKey: projects.projectKey,
        projectDisplayName: projects.displayName,
        projectRootPath: projects.rootPath,
        workUnitId: workUnits.id,
        lastObservedAt: workUnits.lastObservedAt,
        state: inferences.state,
        calculatedAt: inferences.calculatedAt,
      })
      .from(workUnits)
      .innerJoin(projects, eq(workUnits.projectId, projects.id))
      .innerJoin(inferences, eq(inferences.workUnitId, workUnits.id))
      .orderBy(desc(workUnits.lastObservedAt));

    return rows.map((row) => ({
      projectKey: row.projectKey,
      project: {
        displayName: row.projectDisplayName,
        rootPath: row.projectRootPath,
      },
      workUnitId: row.workUnitId,
      state: row.state as ProjectActivityRecord["state"],
      lastActivityAt: row.lastObservedAt ?? row.calculatedAt,
    }));
  }

  async close() {
    await this.client?.end();
  }
}

export function createPostgresProjectsOverviewStore(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 1 });
  return new PostgresProjectsOverviewStore(drizzle(client), client);
}
