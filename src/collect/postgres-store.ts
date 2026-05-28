import { and, eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";

import {
  events,
  forks,
  projects,
  sessions,
  sources,
  workUnits,
} from "../db/schema";
import type {
  CollectionStore,
  StoredEvent,
  StoredFork,
  StoredProject,
  StoredSession,
  StoredSource,
  StoredWorkUnit,
} from "./fixture";

export class PostgresCollectionStore implements CollectionStore {
  constructor(
    private readonly database: PostgresJsDatabase,
    private readonly client?: Sql,
  ) {}

  async upsertSource(
    input: Omit<StoredSource, "id">,
  ): Promise<StoredSource> {
    const [source] = await this.database
      .insert(sources)
      .values({
        sourceKey: input.sourceKey,
        sourceType: input.sourceType,
        path: input.path ?? null,
        healthStatus: input.healthStatus,
      })
      .onConflictDoUpdate({
        target: sources.sourceKey,
        set: {
          sourceType: input.sourceType,
          path: input.path ?? null,
          healthStatus: input.healthStatus,
          updatedAt: new Date(),
        },
      })
      .returning();

    return requireReturnedRow(source, "source");
  }

  async upsertProject(
    input: Omit<StoredProject, "id">,
  ): Promise<StoredProject> {
    const [project] = await this.database
      .insert(projects)
      .values(input)
      .onConflictDoUpdate({
        target: projects.projectKey,
        set: {
          rootPath: input.rootPath,
          displayName: input.displayName,
          updatedAt: new Date(),
        },
      })
      .returning();

    return requireReturnedRow(project, "project");
  }

  async upsertSession(
    input: Omit<StoredSession, "id">,
  ): Promise<StoredSession> {
    const [session] = await this.database
      .insert(sessions)
      .values({
        sourceId: input.sourceId,
        projectId: input.projectId,
        sourceSessionId: input.sourceSessionId,
        startedAt: input.startedAt ?? null,
        lastObservedAt: input.lastObservedAt ?? null,
      })
      .onConflictDoUpdate({
        target: [sessions.sourceId, sessions.sourceSessionId],
        set: {
          projectId: input.projectId,
          startedAt: input.startedAt ?? null,
          lastObservedAt: input.lastObservedAt ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();

    return requireReturnedRow(session, "session");
  }

  async upsertFork(input: Omit<StoredFork, "id">): Promise<StoredFork> {
    const [fork] = await this.database
      .insert(forks)
      .values({
        sessionId: input.sessionId,
        sourceForkId: input.sourceForkId,
        originForkId: input.originForkId ?? null,
        startedAt: input.startedAt ?? null,
        lastObservedAt: input.lastObservedAt ?? null,
      })
      .onConflictDoUpdate({
        target: [forks.sessionId, forks.sourceForkId],
        set: {
          originForkId: input.originForkId ?? null,
          startedAt: input.startedAt ?? null,
          lastObservedAt: input.lastObservedAt ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();

    return requireReturnedRow(fork, "fork");
  }

  async findForkBySourceIdentity({
    sourceId,
    sourceForkId,
  }: {
    sourceId: string;
    sourceForkId: string;
  }): Promise<StoredFork | null> {
    const [fork] = await this.database
      .select({
        id: forks.id,
        sessionId: forks.sessionId,
        sourceForkId: forks.sourceForkId,
        originForkId: forks.originForkId,
        startedAt: forks.startedAt,
        lastObservedAt: forks.lastObservedAt,
      })
      .from(forks)
      .innerJoin(sessions, eq(forks.sessionId, sessions.id))
      .where(
        and(
          eq(sessions.sourceId, sourceId),
          eq(forks.sourceForkId, sourceForkId),
        ),
      )
      .limit(1);

    return fork ?? null;
  }

  async upsertWorkUnit(
    input: Omit<StoredWorkUnit, "id">,
  ): Promise<StoredWorkUnit> {
    const [workUnit] = await this.database
      .insert(workUnits)
      .values({
        projectId: input.projectId,
        sessionId: input.sessionId,
        forkId: input.forkId ?? null,
        identityKey: input.identityKey,
        firstObservedAt: input.firstObservedAt ?? null,
        lastObservedAt: input.lastObservedAt ?? null,
      })
      .onConflictDoUpdate({
        target: workUnits.identityKey,
        set: {
          projectId: input.projectId,
          sessionId: input.sessionId,
          forkId: input.forkId ?? null,
          firstObservedAt: input.firstObservedAt ?? null,
          lastObservedAt: input.lastObservedAt ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();

    return requireReturnedRow(workUnit, "work unit");
  }

  async upsertEvent(input: Omit<StoredEvent, "id">): Promise<StoredEvent> {
    const [event] = await this.database
      .insert(events)
      .values({
        sourceId: input.sourceId,
        projectId: input.projectId,
        sessionId: input.sessionId,
        forkId: input.forkId ?? null,
        workUnitId: input.workUnitId,
        sourceLocator: input.sourceLocator,
        eventType: input.eventType,
        observedAt: input.observedAt,
        metadata: input.metadata,
        rawPayload: input.rawPayload ?? null,
        parserVersion: input.parserVersion,
        sourceVersion: input.sourceVersion ?? null,
      })
      .onConflictDoUpdate({
        target: [events.sourceId, events.sourceLocator],
        set: {
          projectId: input.projectId,
          sessionId: input.sessionId,
          forkId: input.forkId ?? null,
          workUnitId: input.workUnitId,
          eventType: input.eventType,
          observedAt: input.observedAt,
          metadata: input.metadata,
          rawPayload: input.rawPayload ?? null,
          parserVersion: input.parserVersion,
          sourceVersion: input.sourceVersion ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();

    return requireReturnedRow(event, "event") as StoredEvent;
  }

  async close() {
    await this.client?.end();
  }
}

export function createPostgresCollectionStore(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 1 });
  return new PostgresCollectionStore(drizzle(client), client);
}

function requireReturnedRow<T>(row: T | undefined, recordType: string): T {
  if (!row) {
    throw new Error(`Postgres did not return the upserted ${recordType}.`);
  }

  return row;
}
