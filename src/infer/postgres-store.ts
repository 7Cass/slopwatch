import { asc, eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";

import { events, inferences } from "../db/schema";
import type {
  InferenceEvent,
  InferenceStore,
  WorkUnitInference,
} from "./work-unit";

export class PostgresInferenceStore implements InferenceStore {
  constructor(
    private readonly database: PostgresJsDatabase,
    private readonly client?: Sql,
  ) {}

  async listWorkUnitEvents(workUnitId: string): Promise<InferenceEvent[]> {
    const rows = await this.database
      .select({
        eventType: events.eventType,
        observedAt: events.observedAt,
        metadata: events.metadata,
      })
      .from(events)
      .where(eq(events.workUnitId, workUnitId))
      .orderBy(asc(events.observedAt));

    return rows.map((row) => ({
      eventType: row.eventType,
      observedAt: row.observedAt,
      metadata: row.metadata as Record<string, unknown>,
    }));
  }

  async upsertInference(
    inference: WorkUnitInference,
  ): Promise<WorkUnitInference> {
    const [row] = await this.database
      .insert(inferences)
      .values({
        workUnitId: inference.workUnitId,
        state: inference.state,
        confidence: inference.confidence,
        explanation: inference.explanation,
        activeTimeMs: inference.activeTimeMs,
        inferenceVersion: inference.inferenceVersion,
        calculatedAt: inference.calculatedAt,
      })
      .onConflictDoUpdate({
        target: inferences.workUnitId,
        set: {
          state: inference.state,
          confidence: inference.confidence,
          explanation: inference.explanation,
          activeTimeMs: inference.activeTimeMs,
          inferenceVersion: inference.inferenceVersion,
          calculatedAt: inference.calculatedAt,
          updatedAt: new Date(),
        },
      })
      .returning({
        workUnitId: inferences.workUnitId,
        state: inferences.state,
        confidence: inferences.confidence,
        explanation: inferences.explanation,
        activeTimeMs: inferences.activeTimeMs,
        inferenceVersion: inferences.inferenceVersion,
        calculatedAt: inferences.calculatedAt,
      });

    if (!row) {
      throw new Error("Postgres did not return the upserted Inference.");
    }

    return {
      workUnitId: row.workUnitId,
      state: row.state as WorkUnitInference["state"],
      confidence: row.confidence,
      explanation: row.explanation,
      activeTimeMs: row.activeTimeMs,
      inferenceVersion: row.inferenceVersion,
      calculatedAt: row.calculatedAt,
    };
  }

  async close() {
    await this.client?.end();
  }
}

export function createPostgresInferenceStore(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 1 });
  return new PostgresInferenceStore(drizzle(client), client);
}
