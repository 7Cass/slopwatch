import { desc, eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";

import { events, inferences, projects, workUnits } from "../db/schema";
import type {
  NowProjectionSourceRecord,
  NowProjectionStore,
  TokenQuality,
} from "./projection";

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
      })
      .from(workUnits)
      .innerJoin(projects, eq(workUnits.projectId, projects.id))
      .innerJoin(inferences, eq(inferences.workUnitId, workUnits.id))
      .orderBy(desc(workUnits.lastObservedAt));

    return Promise.all(
      rows.map(async (row) => {
        const latestEvent = await this.findLatestEvent(row.workUnitId);
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
          tokenQuality: readTokenQuality(metadata?.tokenQuality),
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

function readTokenQuality(value: unknown): TokenQuality | undefined {
  return value === "real" || value === "estimated" || value === "unavailable"
    ? value
    : undefined;
}
