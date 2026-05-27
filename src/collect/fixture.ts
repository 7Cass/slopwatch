export type JsonMetadata = Record<string, unknown>;

export type StoredSource = {
  id: string;
  sourceKey: string;
  sourceType: string;
  path?: string | null;
  healthStatus: string;
};

export type StoredProject = {
  id: string;
  projectKey: string;
  rootPath: string;
  displayName: string;
};

export type StoredSession = {
  id: string;
  sourceId: string;
  projectId: string;
  sourceSessionId: string;
  startedAt?: Date | null;
  lastObservedAt?: Date | null;
};

export type StoredFork = {
  id: string;
  sessionId: string;
  sourceForkId: string;
  originForkId?: string | null;
  startedAt?: Date | null;
  lastObservedAt?: Date | null;
};

export type StoredWorkUnit = {
  id: string;
  projectId: string;
  sessionId: string;
  forkId?: string | null;
  identityKey: string;
  firstObservedAt?: Date | null;
  lastObservedAt?: Date | null;
};

export type StoredEvent = {
  id: string;
  sourceId: string;
  projectId: string;
  sessionId: string;
  forkId?: string | null;
  workUnitId: string;
  sourceLocator: string;
  eventType: string;
  observedAt: Date;
  metadata: JsonMetadata;
  rawPayload?: string | null;
  parserVersion: string;
  sourceVersion?: string | null;
};

export type CollectionStore = {
  upsertSource: (input: Omit<StoredSource, "id">) => Promise<StoredSource>;
  upsertProject: (input: Omit<StoredProject, "id">) => Promise<StoredProject>;
  upsertSession: (input: Omit<StoredSession, "id">) => Promise<StoredSession>;
  upsertFork: (input: Omit<StoredFork, "id">) => Promise<StoredFork>;
  upsertWorkUnit: (
    input: Omit<StoredWorkUnit, "id">,
  ) => Promise<StoredWorkUnit>;
  upsertEvent: (input: Omit<StoredEvent, "id">) => Promise<StoredEvent>;
};

export type SourceRecord = {
  source: Omit<StoredSource, "id">;
  project: Omit<StoredProject, "id">;
  session: Omit<StoredSession, "id" | "sourceId" | "projectId">;
  fork: Omit<StoredFork, "id" | "sessionId">;
  workUnit: Omit<
    StoredWorkUnit,
    "id" | "projectId" | "sessionId" | "forkId"
  >;
  event: Omit<
    StoredEvent,
    "id" | "sourceId" | "projectId" | "sessionId" | "forkId" | "workUnitId"
  >;
};

export type FixtureCollectionSummary = {
  sourceKey: string;
  eventsProcessed: number;
  workUnitsProcessed: number;
};

const fixtureSourceKey = "fixture:codex-local-demo";
const fixtureSourceVersion = "fixture-v1";
const fixtureParserVersion = "fixture-parser-v1";
const firstObservedAt = new Date("2026-05-01T10:00:00.000Z");
const lastObservedAt = new Date("2026-05-01T10:04:00.000Z");

export async function collectFixtureSource({
  store,
}: {
  store: CollectionStore;
}): Promise<FixtureCollectionSummary> {
  return collectSourceRecords({ store, records: readFixtureSourceRecords() });
}

export async function collectSourceRecords({
  store,
  records,
}: {
  store: CollectionStore;
  records: SourceRecord[];
}): Promise<FixtureCollectionSummary> {
  const processedWorkUnits = new Set<string>();

  for (const record of records) {
    const source = await store.upsertSource(record.source);
    const project = await store.upsertProject(record.project);
    const session = await store.upsertSession({
      ...record.session,
      sourceId: source.id,
      projectId: project.id,
    });
    const fork = await store.upsertFork({
      ...record.fork,
      sessionId: session.id,
    });
    const workUnit = await store.upsertWorkUnit({
      ...record.workUnit,
      projectId: project.id,
      sessionId: session.id,
      forkId: fork.id,
    });

    await store.upsertEvent({
      ...record.event,
      sourceId: source.id,
      projectId: project.id,
      sessionId: session.id,
      forkId: fork.id,
      workUnitId: workUnit.id,
    });

    processedWorkUnits.add(workUnit.identityKey);
  }

  return {
    sourceKey: records[0]?.source.sourceKey ?? fixtureSourceKey,
    eventsProcessed: records.length,
    workUnitsProcessed: processedWorkUnits.size,
  };
}

export function readFixtureSourceRecords(): SourceRecord[] {
  const commonSource = {
    sourceKey: fixtureSourceKey,
    sourceType: "fixture",
    path: "fixture://codex-local-demo",
    healthStatus: "ok",
  };
  const commonProject = {
    projectKey: "fixture:/projects/slopwatch-demo",
    rootPath: "/projects/slopwatch-demo",
    displayName: "slopwatch-demo",
  };
  const commonSession = {
    sourceSessionId: "session-001",
    startedAt: firstObservedAt,
    lastObservedAt,
  };
  const commonFork = {
    sourceForkId: "fork-main",
    originForkId: null,
    startedAt: firstObservedAt,
    lastObservedAt,
  };
  const commonWorkUnit = {
    identityKey: "fixture:codex-local-demo:session-001:fork-main",
    firstObservedAt,
    lastObservedAt,
  };

  return [
    {
      source: commonSource,
      project: commonProject,
      session: commonSession,
      fork: commonFork,
      workUnit: commonWorkUnit,
      event: {
        sourceLocator: "fixture/codex-local-demo/session-001/fork-main/0001",
        eventType: "session_started",
        observedAt: firstObservedAt,
        metadata: {
          action: "started",
          cwd: commonProject.rootPath,
          toolCalls: 0,
        },
        rawPayload: null,
        parserVersion: fixtureParserVersion,
        sourceVersion: fixtureSourceVersion,
      },
    },
    {
      source: commonSource,
      project: commonProject,
      session: commonSession,
      fork: commonFork,
      workUnit: commonWorkUnit,
      event: {
        sourceLocator: "fixture/codex-local-demo/session-001/fork-main/0002",
        eventType: "tool_call",
        observedAt: new Date("2026-05-01T10:02:00.000Z"),
        metadata: {
          action: "ran command",
          command: "bun test",
          toolName: "exec_command",
          toolCalls: 1,
        },
        rawPayload: null,
        parserVersion: fixtureParserVersion,
        sourceVersion: fixtureSourceVersion,
      },
    },
    {
      source: commonSource,
      project: commonProject,
      session: commonSession,
      fork: commonFork,
      workUnit: commonWorkUnit,
      event: {
        sourceLocator: "fixture/codex-local-demo/session-001/fork-main/0003",
        eventType: "assistant_message",
        observedAt: lastObservedAt,
        metadata: {
          action: "reported progress",
          summary: "Implemented the first collection tracer bullet.",
          toolCalls: 1,
          tokenQuality: "unavailable",
        },
        rawPayload: null,
        parserVersion: fixtureParserVersion,
        sourceVersion: fixtureSourceVersion,
      },
    },
  ];
}
