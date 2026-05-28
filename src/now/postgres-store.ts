import { desc, eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { alias } from "drizzle-orm/pg-core";
import postgres, { type Sql } from "postgres";

import { events, forks, inferences, projects, workUnits } from "../db/schema";
import type {
  NowProjectionSourceRecord,
  NowProjectionStore,
} from "./projection";
import { selectTokenQuality } from "./token-quality";

const originForks = alias(forks, "origin_forks");
const originWorkUnits = alias(workUnits, "origin_work_units");
const originProjects = alias(projects, "origin_projects");

export class PostgresNowProjectionStore implements NowProjectionStore {
  constructor(
    private readonly database: PostgresJsDatabase,
    private readonly client?: Sql,
  ) {}

  async listNowProjectionRecords(): Promise<NowProjectionSourceRecord[]> {
    const rows = await this.database
      .select({
        workUnitId: workUnits.id,
        projectDisplayName: projects.displayName,
        projectRootPath: projects.rootPath,
        lastObservedAt: workUnits.lastObservedAt,
        state: inferences.state,
        confidence: inferences.confidence,
        explanation: inferences.explanation,
        activeTimeMs: inferences.activeTimeMs,
        calculatedAt: inferences.calculatedAt,
        originWorkUnitId: originWorkUnits.id,
        originProjectDisplayName: originProjects.displayName,
        originProjectRootPath: originProjects.rootPath,
      })
      .from(workUnits)
      .innerJoin(projects, eq(workUnits.projectId, projects.id))
      .innerJoin(inferences, eq(inferences.workUnitId, workUnits.id))
      .leftJoin(forks, eq(workUnits.forkId, forks.id))
      .leftJoin(originForks, eq(forks.originForkId, originForks.id))
      .leftJoin(originWorkUnits, eq(originWorkUnits.forkId, originForks.id))
      .leftJoin(originProjects, eq(originWorkUnits.projectId, originProjects.id))
      .orderBy(desc(workUnits.lastObservedAt));

    return Promise.all(
      rows.map(async (row) => {
        const latestEvent = await this.findLatestEvent(row.workUnitId);
        const tokenQuality = await this.findTokenQuality(row.workUnitId);
        const metadata = latestEvent?.metadata as
          | Record<string, unknown>
          | undefined;

        return {
          workUnitId: row.workUnitId,
          project: {
            displayName: row.projectDisplayName,
            rootPath: row.projectRootPath,
          },
          state: row.state as NowProjectionSourceRecord["state"],
          confidence: row.confidence,
          explanation: row.explanation,
          activeTimeMs: row.activeTimeMs,
          lastActivityAt:
            row.lastObservedAt ?? latestEvent?.observedAt ?? row.calculatedAt,
          lastAction: readString(metadata?.action) ?? latestEvent?.eventType,
          toolCalls: readNumber(metadata?.toolCalls),
          tokenQuality,
          forkOrigin:
            row.originWorkUnitId &&
            row.originProjectDisplayName &&
            row.originProjectRootPath
              ? {
                  originWorkUnitId: row.originWorkUnitId,
                  originProject: {
                    displayName: row.originProjectDisplayName,
                    rootPath: row.originProjectRootPath,
                  },
                }
              : undefined,
        };
      }),
    );
  }

  async close() {
    await this.client?.end();
  }

  private async findLatestEvent(workUnitId: string) {
    const [event] = await this.database
      .select({
        eventType: events.eventType,
        observedAt: events.observedAt,
        metadata: events.metadata,
      })
      .from(events)
      .where(eq(events.workUnitId, workUnitId))
      .orderBy(desc(events.observedAt))
      .limit(1);

    return event;
  }

  private async findTokenQuality(workUnitId: string) {
    const rows = await this.database
      .select({
        metadata: events.metadata,
      })
      .from(events)
      .where(eq(events.workUnitId, workUnitId))
      .orderBy(desc(events.observedAt));

    return selectTokenQuality(
      rows.map(
        (row) =>
          (row.metadata as Record<string, unknown> | undefined)?.tokenQuality,
      ),
    );
  }
}

export function createPostgresNowProjectionStore(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 1 });
  return new PostgresNowProjectionStore(drizzle(client), client);
}

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown) {
  return typeof value === "number" ? value : undefined;
}
