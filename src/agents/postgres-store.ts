import { asc, eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { alias } from "drizzle-orm/pg-core";
import postgres, { type Sql } from "postgres";

import {
  events,
  forks,
  inferences,
  projects,
  sources,
  workUnits,
} from "../db/schema";
import type {
  AgentDetailRecord,
  AgentDetailStore,
} from "./detail";

const originForks = alias(forks, "origin_forks");
const originWorkUnits = alias(workUnits, "origin_work_units");

export class PostgresAgentDetailStore implements AgentDetailStore {
  constructor(
    private readonly database: PostgresJsDatabase,
    private readonly client?: Sql,
  ) {}

  async getAgentDetailRecord(
    workUnitId: string,
  ): Promise<AgentDetailRecord | null> {
    const [workUnit] = await this.database
      .select({
        workUnitId: workUnits.id,
        projectDisplayName: projects.displayName,
        projectRootPath: projects.rootPath,
        lastObservedAt: workUnits.lastObservedAt,
        state: inferences.state,
        confidence: inferences.confidence,
        explanation: inferences.explanation,
        activeTimeMs: inferences.activeTimeMs,
        inferenceVersion: inferences.inferenceVersion,
        calculatedAt: inferences.calculatedAt,
        sourceForkId: forks.sourceForkId,
        sourceOriginForkId: forks.sourceOriginForkId,
        originForkId: forks.originForkId,
        originSourceForkId: originForks.sourceForkId,
        originWorkUnitId: originWorkUnits.id,
      })
      .from(workUnits)
      .innerJoin(projects, eq(workUnits.projectId, projects.id))
      .innerJoin(inferences, eq(inferences.workUnitId, workUnits.id))
      .leftJoin(forks, eq(workUnits.forkId, forks.id))
      .leftJoin(originForks, eq(forks.originForkId, originForks.id))
      .leftJoin(originWorkUnits, eq(originWorkUnits.forkId, originForks.id))
      .where(eq(workUnits.id, workUnitId))
      .limit(1);

    if (!workUnit) {
      return null;
    }

    const eventRows = await this.database
      .select({
        id: events.id,
        eventType: events.eventType,
        observedAt: events.observedAt,
        sourceLocator: events.sourceLocator,
        metadata: events.metadata,
        rawPayload: events.rawPayload,
        sourceKey: sources.sourceKey,
        sourceType: sources.sourceType,
        sourcePath: sources.path,
      })
      .from(events)
      .innerJoin(sources, eq(events.sourceId, sources.id))
      .where(eq(events.workUnitId, workUnitId))
      .orderBy(asc(events.observedAt));

    return {
      workUnitId: workUnit.workUnitId,
      project: {
        displayName: workUnit.projectDisplayName,
        rootPath: workUnit.projectRootPath,
      },
      state: workUnit.state as AgentDetailRecord["state"],
      activeTimeMs: workUnit.activeTimeMs,
      lastActivityAt: workUnit.lastObservedAt ?? workUnit.calculatedAt,
      inference: {
        confidence: workUnit.confidence,
        explanation: workUnit.explanation,
        inferenceVersion: workUnit.inferenceVersion,
        calculatedAt: workUnit.calculatedAt,
      },
      forkOrigin: workUnit.sourceForkId
        ? {
            sourceForkId: workUnit.sourceForkId,
            originForkId:
              workUnit.sourceOriginForkId ??
              workUnit.originSourceForkId ??
              workUnit.originForkId ??
              null,
            originStatus: workUnit.originForkId
              ? "resolved"
              : workUnit.sourceOriginForkId
                ? "unresolved"
              : undefined,
            originWorkUnitId: workUnit.originWorkUnitId ?? null,
          }
        : undefined,
      events: eventRows.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        observedAt: event.observedAt,
        source: {
          sourceKey: event.sourceKey,
          sourceType: event.sourceType,
          sourceLocator: event.sourceLocator,
          path: event.sourcePath,
        },
        metadata: event.metadata as Record<string, unknown>,
        rawPayload: event.rawPayload,
      })),
    };
  }

  async close() {
    await this.client?.end();
  }
}

export function createPostgresAgentDetailStore(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 1 });
  return new PostgresAgentDetailStore(drizzle(client), client);
}
