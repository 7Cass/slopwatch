import { describe, expect, test } from "bun:test";

import {
  collectSourceRecords,
  collectFixtureSource,
  readFixtureSourceRecords,
  type CollectionStore,
  type SourceRecord,
  type StoredEvent,
  type StoredFork,
  type StoredProject,
  type StoredSession,
  type StoredSource,
  type StoredWorkUnit,
} from "../src/collect/fixture";
import {
  getAgentDetail,
  type AgentDetailRecord,
  type AgentDetailStore,
} from "../src/agents/detail";
import {
  runCodexLocalCollection,
  runFixtureCollection,
} from "../src/collect/run";
import type {
  InferenceEvent,
  InferenceStore,
  WorkUnitInference,
} from "../src/infer/work-unit";
import {
  getNowProjection,
  type NowProjectionSourceRecord,
  type NowProjectionStore,
  type TokenQuality,
} from "../src/now/projection";

class InMemoryCollectionStore
  implements CollectionStore, InferenceStore, AgentDetailStore, NowProjectionStore
{
  private nextId = 1;
  readonly sources = new Map<string, StoredSource>();
  readonly projects = new Map<string, StoredProject>();
  readonly sessions = new Map<string, StoredSession>();
  readonly forks = new Map<string, StoredFork>();
  readonly workUnits = new Map<string, StoredWorkUnit>();
  readonly events = new Map<string, StoredEvent>();
  readonly inferences = new Map<string, WorkUnitInference>();

  async upsertSource(input: Parameters<CollectionStore["upsertSource"]>[0]) {
    const existing = this.sources.get(input.sourceKey);
    const source = {
      ...existing,
      ...input,
      id: existing?.id ?? this.allocateId(),
    };

    this.sources.set(input.sourceKey, source);
    return source;
  }

  async upsertProject(input: Parameters<CollectionStore["upsertProject"]>[0]) {
    const existing = this.projects.get(input.projectKey);
    const project = {
      ...existing,
      ...input,
      id: existing?.id ?? this.allocateId(),
    };

    this.projects.set(input.projectKey, project);
    return project;
  }

  async upsertSession(input: Parameters<CollectionStore["upsertSession"]>[0]) {
    const sessionKey = `${input.sourceId}:${input.sourceSessionId}`;
    const existing = this.sessions.get(sessionKey);
    const session = {
      ...existing,
      ...input,
      id: existing?.id ?? this.allocateId(),
    };

    this.sessions.set(sessionKey, session);
    return session;
  }

  async upsertFork(input: Parameters<CollectionStore["upsertFork"]>[0]) {
    const forkKey = `${input.sessionId}:${input.sourceForkId}`;
    const existing = this.forks.get(forkKey);
    const fork = {
      ...existing,
      ...input,
      id: existing?.id ?? this.allocateId(),
    };

    this.forks.set(forkKey, fork);
    return fork;
  }

  async findForkBySourceIdentity({
    sourceId,
    sourceForkId,
  }: {
    sourceId: string;
    sourceForkId: string;
  }) {
    return (
      [...this.forks.values()].find((fork) => {
        const session = [...this.sessions.values()].find(
          (candidate) => candidate.id === fork.sessionId,
        );

        return (
          session?.sourceId === sourceId && fork.sourceForkId === sourceForkId
        );
      }) ?? null
    );
  }

  async resolveDeferredForkOrigins({
    sourceId,
    sourceForkId,
    originForkId,
  }: {
    sourceId: string;
    sourceForkId: string;
    originForkId: string;
  }) {
    for (const [forkKey, fork] of this.forks) {
      const session = [...this.sessions.values()].find(
        (candidate) => candidate.id === fork.sessionId,
      );

      if (
        session?.sourceId === sourceId &&
        fork.sourceOriginForkId === sourceForkId &&
        !fork.originForkId
      ) {
        this.forks.set(forkKey, {
          ...fork,
          originForkId,
        });
      }
    }
  }

  async upsertWorkUnit(
    input: Parameters<CollectionStore["upsertWorkUnit"]>[0],
  ) {
    const existing = this.workUnits.get(input.identityKey);
    const workUnit = {
      ...existing,
      ...input,
      id: existing?.id ?? this.allocateId(),
    };

    this.workUnits.set(input.identityKey, workUnit);
    return workUnit;
  }

  async upsertEvent(input: Parameters<CollectionStore["upsertEvent"]>[0]) {
    const eventKey = `${input.sourceId}:${input.sourceLocator}`;
    const existing = this.events.get(eventKey);
    const event = {
      ...existing,
      ...input,
      id: existing?.id ?? this.allocateId(),
    };

    this.events.set(eventKey, event);
    return event;
  }

  async listWorkUnitEvents(workUnitId: string): Promise<InferenceEvent[]> {
    return [...this.events.values()]
      .filter((event) => event.workUnitId === workUnitId)
      .sort(
        (left, right) =>
          left.observedAt.getTime() - right.observedAt.getTime(),
      )
      .map((event) => ({
        eventType: event.eventType,
        observedAt: event.observedAt,
        metadata: event.metadata,
      }));
  }

  async upsertInference(inference: WorkUnitInference) {
    this.inferences.set(inference.workUnitId, inference);
    return inference;
  }

  async getAgentDetailRecord(
    workUnitId: string,
  ): Promise<AgentDetailRecord | null> {
    const workUnit = [...this.workUnits.values()].find(
      (candidate) => candidate.id === workUnitId,
    );
    const project = workUnit
      ? [...this.projects.values()].find(
          (candidate) => candidate.id === workUnit.projectId,
        )
      : undefined;
    const inference = this.inferences.get(workUnitId);

    if (!workUnit || !project || !inference) {
      return null;
    }

    const fork = workUnit.forkId
      ? [...this.forks.values()].find(
          (candidate) => candidate.id === workUnit.forkId,
        )
      : undefined;
    const originFork = fork?.originForkId
      ? [...this.forks.values()].find(
          (candidate) => candidate.id === fork.originForkId,
        )
      : undefined;
    const originWorkUnit = originFork
      ? [...this.workUnits.values()].find(
          (candidate) => candidate.forkId === originFork.id,
        )
      : undefined;

    return {
      workUnitId,
      project: {
        displayName: project.displayName,
        rootPath: project.rootPath,
      },
      state: inference.state,
      activeTimeMs: inference.activeTimeMs,
      lastActivityAt: workUnit.lastObservedAt ?? inference.calculatedAt,
      inference: {
        confidence: inference.confidence,
        explanation: inference.explanation,
        inferenceVersion: inference.inferenceVersion,
        calculatedAt: inference.calculatedAt,
      },
      forkOrigin: fork
        ? {
            sourceForkId: fork.sourceForkId,
            originForkId:
              originFork?.sourceForkId ??
              fork.sourceOriginForkId ??
              fork.originForkId ??
              null,
            originWorkUnitId: originWorkUnit?.id ?? null,
            ...(originFork
              ? { originStatus: "resolved" as const }
              : fork.sourceOriginForkId
                ? { originStatus: "unresolved" as const }
                : {}),
          }
        : undefined,
      events: [...this.events.values()]
        .filter((event) => event.workUnitId === workUnitId)
        .map((event) => {
          const source = [...this.sources.values()].find(
            (candidate) => candidate.id === event.sourceId,
          );

          if (!source) {
            throw new Error("Expected Event source to be persisted.");
          }

          return {
            id: event.id,
            eventType: event.eventType,
            observedAt: event.observedAt,
            source: {
              sourceKey: source.sourceKey,
              sourceType: source.sourceType,
              sourceLocator: event.sourceLocator,
              path: source.path,
            },
            metadata: event.metadata,
            rawPayload: event.rawPayload,
          };
        }),
    };
  }

  async listNowProjectionRecords(): Promise<NowProjectionSourceRecord[]> {
    return [...this.workUnits.values()].map((workUnit) => {
      const project = [...this.projects.values()].find(
        (candidate) => candidate.id === workUnit.projectId,
      );
      const inference = this.inferences.get(workUnit.id);
      const latestEvent = [...this.events.values()]
        .filter((event) => event.workUnitId === workUnit.id)
        .sort(
          (left, right) =>
            right.observedAt.getTime() - left.observedAt.getTime(),
        )[0];

      if (!project || !inference) {
        throw new Error("Expected WorkUnit projection dependencies.");
      }

      return {
        workUnitId: workUnit.id,
        project: {
          displayName: project.displayName,
          rootPath: project.rootPath,
        },
        state: inference.state,
        confidence: inference.confidence,
        explanation: inference.explanation,
        activeTimeMs: inference.activeTimeMs,
        lastActivityAt:
          workUnit.lastObservedAt ??
          latestEvent?.observedAt ??
          inference.calculatedAt,
        lastAction:
          readString(latestEvent?.metadata.action) ?? latestEvent?.eventType,
        toolCalls: readNumber(latestEvent?.metadata.toolCalls),
        tokenQuality: readTokenQuality(latestEvent?.metadata.tokenQuality),
      };
    });
  }

  private allocateId() {
    return String(this.nextId++);
  }
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

function firstFixtureRecord() {
  const [record] = readFixtureSourceRecords();

  if (!record) {
    throw new Error("Fixture Source should provide at least one record.");
  }

  return record;
}

function codexCollectionConfig() {
  return {
    databaseUrl: "postgres://localhost/slopwatch_codex",
    sources: [
      {
        sourceKey: "codex-local:default",
        sourceType: "codex-local",
        path: "/sources/configured-codex",
      },
    ],
  };
}

async function configuredCodexSourceList(
  input: {
    config?: {
      sources?: Array<{
        sourceKey?: string;
        sourceType: string;
        path: string;
      }>;
    };
  } = {},
) {
  return (input.config?.sources ?? []).map((source) => ({
    sourceKey: source.sourceKey ?? `${source.sourceType}:${source.path}`,
    sourceType: source.sourceType,
    path: source.path,
    origin: "configured" as const,
    overridden: true,
    health: { status: "ok" as const },
    format: { status: "ok" as const },
  }));
}

function codexLocalFixtureRecords({
  finalEvent,
}: {
  finalEvent?: Partial<SourceRecord["event"]>;
} = {}) {
  return readFixtureSourceRecords().map((record) => {
    const isFinalEvent = record.event.sourceLocator.endsWith("/0003");

    return {
      ...record,
      source: {
        sourceKey: "codex-local:default",
        sourceType: "codex-local",
        path: "/sources/configured-codex",
        healthStatus: "ok",
      },
      workUnit: {
        ...record.workUnit,
        identityKey: "codex-local:default:thread-main",
      },
      event: {
        ...record.event,
        ...(isFinalEvent ? finalEvent : {}),
        sourceLocator: record.event.sourceLocator.replace(
          "fixture/codex-local-demo/session-001/fork-main",
          "sessions/2026/05/27/rollout-thread-main.jsonl",
        ),
        parserVersion: "codex-local-v0",
        sourceVersion: "0.134.0",
      },
    };
  });
}

function codexForkRelationshipRecords(): SourceRecord[] {
  const source = {
    sourceKey: "codex-local:default",
    sourceType: "codex-local",
    path: "/sources/configured-codex",
    healthStatus: "ok",
  };
  const project = {
    projectKey: "local:/projects/slopwatch-demo",
    rootPath: "/projects/slopwatch-demo",
    displayName: "slopwatch-demo",
  };

  return [
    codexForkRelationshipRecord({
      source,
      project,
      sourceForkId: "thread-parent",
      originForkId: null,
      observedAt: new Date("2026-05-27T10:00:00.000Z"),
      sourceLocator:
        "sessions/2026/05/27/rollout-thread-parent.jsonl:1",
    }),
    codexForkRelationshipRecord({
      source,
      project,
      sourceForkId: "thread-child",
      originForkId: "thread-parent",
      observedAt: new Date("2026-05-27T10:01:00.000Z"),
      sourceLocator:
        "sessions/2026/05/27/rollout-thread-child.jsonl:1",
    }),
  ];
}

function codexForkRelationshipRecord({
  source,
  project,
  sourceForkId,
  originForkId,
  observedAt,
  sourceLocator,
}: {
  source: SourceRecord["source"];
  project: SourceRecord["project"];
  sourceForkId: string;
  originForkId: string | null;
  observedAt: Date;
  sourceLocator: string;
}): SourceRecord {
  return {
    source,
    project,
    session: {
      sourceSessionId: sourceForkId,
      startedAt: observedAt,
      lastObservedAt: observedAt,
    },
    fork: {
      sourceForkId,
      originForkId,
      startedAt: observedAt,
      lastObservedAt: observedAt,
    },
    workUnit: {
      identityKey: `codex-local:default:${sourceForkId}`,
      firstObservedAt: observedAt,
      lastObservedAt: observedAt,
    },
    event: {
      sourceLocator,
      eventType: "assistant_message",
      observedAt,
      metadata: {
        action: "reported progress",
        toolCalls: 0,
      },
      rawPayload: null,
      parserVersion: "codex-local-v0",
      sourceVersion: "0.134.0",
    },
  };
}

async function collectCodexRecords({
  store,
  records,
}: {
  store: InMemoryCollectionStore;
  records: SourceRecord[];
}) {
  return runCodexLocalCollection({
    config: codexCollectionConfig(),
    env: { CODEX_HOME: "/sources/detected-codex" },
    sourceList: configuredCodexSourceList,
    sourceReader: async () => records,
    storeFactory: () => store,
    inferenceStoreFactory: () => store,
  });
}

function findForkBySourceForkId(
  store: InMemoryCollectionStore,
  sourceForkId: string,
) {
  return [...store.forks.values()].find(
    (fork) => fork.sourceForkId === sourceForkId,
  );
}

function findWorkUnitByIdentityKey(
  store: InMemoryCollectionStore,
  identityKey: string,
) {
  return [...store.workUnits.values()].find(
    (workUnit) => workUnit.identityKey === identityKey,
  );
}

describe("collection", () => {
  test("writes deterministic fixture Events and domain identity", async () => {
    const store = new InMemoryCollectionStore();

    const summary = await collectFixtureSource({ store });

    expect(summary).toMatchObject({
      sourceKey: "fixture:codex-local-demo",
      eventsProcessed: 3,
      workUnitsProcessed: 1,
    });
    expect(store.sources.size).toBe(1);
    expect(store.projects.size).toBe(1);
    expect(store.sessions.size).toBe(1);
    expect(store.forks.size).toBe(1);
    expect(store.workUnits.size).toBe(1);
    expect(store.events.size).toBe(3);

    expect([...store.events.values()].map((event) => event.sourceLocator)).toEqual(
      [
        "fixture/codex-local-demo/session-001/fork-main/0001",
        "fixture/codex-local-demo/session-001/fork-main/0002",
        "fixture/codex-local-demo/session-001/fork-main/0003",
      ],
    );
    const [workUnit] = [...store.workUnits.values()];

    if (!workUnit) {
      throw new Error("Fixture collection should create one WorkUnit.");
    }

    expect(workUnit.identityKey).toBe(
      "fixture:codex-local-demo:session-001:fork-main",
    );
    expect(summary.workUnitIds).toEqual([workUnit.id]);
  });

  test("deduplicates reruns by Source locator while preserving stable WorkUnit identity", async () => {
    const store = new InMemoryCollectionStore();
    const firstRecords = readFixtureSourceRecords();

    await collectSourceRecords({ store, records: firstRecords });
    const firstWorkUnitId = [...store.workUnits.values()][0]?.id;
    const firstEventIds = [...store.events.values()].map((event) => event.id);

    const changedRecords = firstRecords.map((record) =>
      record.event.sourceLocator.endsWith("/0002")
        ? {
            ...record,
            event: {
              ...record.event,
              metadata: {
                ...record.event.metadata,
                command: "bun test --rerun",
              },
              parserVersion: "fixture-parser-v2",
            },
          }
        : record,
    );

    await collectSourceRecords({ store, records: changedRecords });

    expect(store.events.size).toBe(3);
    expect(store.workUnits.size).toBe(1);
    expect([...store.workUnits.values()][0]?.id).toBe(firstWorkUnitId);
    expect([...store.events.values()].map((event) => event.id)).toEqual(
      firstEventIds,
    );

    const updatedEvent = [...store.events.values()].find((event) =>
      event.sourceLocator.endsWith("/0002"),
    );
    expect(updatedEvent?.metadata).toMatchObject({
      command: "bun test --rerun",
    });
    expect(updatedEvent?.parserVersion).toBe("fixture-parser-v2");
    expect(updatedEvent?.sourceVersion).toBe("fixture-v1");
  });

  test("collects fixture Events inside a bounded window without duplicating Source locators", async () => {
    const store = new InMemoryCollectionStore();
    const records = readFixtureSourceRecords();
    const collectionWindow = {
      since: new Date("2026-05-01T10:02:00.000Z"),
    };

    const summary = await collectSourceRecords({
      store,
      records,
      collectionWindow,
    });
    const firstEventIds = [...store.events.values()].map((event) => event.id);

    expect(summary).toMatchObject({
      sourceKey: "fixture:codex-local-demo",
      eventsProcessed: 2,
      workUnitsProcessed: 1,
      collectionWindow,
    });
    expect([...store.events.values()].map((event) => event.sourceLocator)).toEqual(
      [
        "fixture/codex-local-demo/session-001/fork-main/0002",
        "fixture/codex-local-demo/session-001/fork-main/0003",
      ],
    );

    const changedRecords = records.map((record) =>
      record.event.sourceLocator.endsWith("/0003")
        ? {
            ...record,
            event: {
              ...record.event,
              metadata: {
                ...record.event.metadata,
                summary: "Backfill refreshed recent activity.",
              },
              parserVersion: "fixture-parser-v2",
              sourceVersion: "fixture-v2",
            },
          }
        : record,
    );

    await collectSourceRecords({
      store,
      records: changedRecords,
      collectionWindow,
    });

    expect(store.events.size).toBe(2);
    expect([...store.events.values()].map((event) => event.id)).toEqual(
      firstEventIds,
    );

    const updatedEvent = [...store.events.values()].find((event) =>
      event.sourceLocator.endsWith("/0003"),
    );
    expect(updatedEvent?.metadata).toMatchObject({
      summary: "Backfill refreshed recent activity.",
    });
    expect(updatedEvent?.parserVersion).toBe("fixture-parser-v2");
    expect(updatedEvent?.sourceVersion).toBe("fixture-v2");
  });

  test("stores metadata only by default without prompt, response, Raw payload, or file contents", async () => {
    const store = new InMemoryCollectionStore();
    const record = firstFixtureRecord();

    await collectSourceRecords({
      store,
      records: [
        {
          ...record,
          event: {
            ...record.event,
            metadata: {
              action: "processed source text",
              promptText: "Please inspect this private request.",
              responseText: "Here is a private answer.",
              fileContent: "export const secret = 'source file body';",
              filePath: "/projects/slopwatch-demo/src/private.ts",
            },
            rawPayload: "full prompt and response transcript",
          },
        },
      ],
    });

    const [event] = [...store.events.values()];

    expect(event?.rawPayload).toBeNull();
    expect(event?.metadata).toEqual({
      action: "processed source text",
      filePath: "/projects/slopwatch-demo/src/private.ts",
    });
  });

  test("stores Raw payload only when content collection is explicitly enabled", async () => {
    const store = new InMemoryCollectionStore();
    const record = firstFixtureRecord();

    await collectSourceRecords({
      store,
      includeContent: true,
      records: [
        {
          ...record,
          event: {
            ...record.event,
            metadata: {
              action: "assistant responded",
            },
            rawPayload: "full assistant response text",
          },
        },
      ],
    });

    const [event] = [...store.events.values()];

    expect(event?.metadata).toEqual({
      action: "assistant responded",
    });
    expect(event?.rawPayload).toBe("full assistant response text");
  });

  test("keeps file contents out of persisted Events even when content collection is enabled", async () => {
    const store = new InMemoryCollectionStore();
    const record = firstFixtureRecord();

    await collectSourceRecords({
      store,
      includeContent: true,
      records: [
        {
          ...record,
          event: {
            ...record.event,
            metadata: {
              action: "read file",
              filesTouched: 1,
              patch: "@@ export const privateValue = 'source body';",
              fileContent: "export const privateValue = 'source body';",
            },
            rawPayload: "export const privateValue = 'source body';",
            rawPayloadKind: "file_content",
          },
        },
      ],
    });

    const [event] = [...store.events.values()];

    expect(event?.rawPayload).toBeNull();
    expect(event?.metadata).toEqual({
      action: "read file",
      filesTouched: 1,
    });
  });

  test("redacts secret-shaped command and metadata strings before persistence", async () => {
    const store = new InMemoryCollectionStore();
    const record = firstFixtureRecord();

    await collectSourceRecords({
      store,
      records: [
        {
          ...record,
          event: {
            ...record.event,
            metadata: {
              action: "ran command",
              command:
                "OPENAI_API_KEY=sk-live-secret curl -H 'Authorization: Bearer bearer-secret'",
              token: "ghp_token_secret",
              headers: {
                authorization: "Bearer nested-secret",
              },
              env: ["ANTHROPIC_API_KEY=sk-ant-secret"],
              tokenQuality: "unavailable",
            },
          },
        },
      ],
    });

    const [event] = [...store.events.values()];

    expect(event?.metadata).toEqual({
      action: "ran command",
      command:
        "OPENAI_API_KEY=[REDACTED] curl -H 'Authorization: Bearer [REDACTED]'",
      token: "[REDACTED]",
      headers: {
        authorization: "[REDACTED]",
      },
      env: ["ANTHROPIC_API_KEY=[REDACTED]"],
      tokenQuality: "unavailable",
    });
  });

  test("fixture collection runner requires and uses the configured DATABASE_URL", async () => {
    await expect(
      runFixtureCollection({
        config: {},
        storeFactory: () => new InMemoryCollectionStore(),
      }),
    ).rejects.toThrow("DATABASE_URL is required");

    const store = new InMemoryCollectionStore();
    const databaseUrls: string[] = [];
    let closed = false;

    const summary = await runFixtureCollection({
      config: { databaseUrl: "postgres://localhost/slopwatch_fixture" },
      storeFactory: (databaseUrl) => {
        databaseUrls.push(databaseUrl);
        return Object.assign(store, {
          close: async () => {
            closed = true;
          },
        });
      },
      inferenceStoreFactory: (databaseUrl) => {
        databaseUrls.push(databaseUrl);
        return store;
      },
    });

    expect(summary.eventsProcessed).toBe(3);
    expect(databaseUrls).toEqual([
      "postgres://localhost/slopwatch_fixture",
      "postgres://localhost/slopwatch_fixture",
    ]);
    expect([...store.inferences.values()]).toMatchObject([
      {
        state: "active",
        inferenceVersion: "work-unit-inference-v1",
      },
    ]);
    expect(closed).toBe(true);
  });

  test("fixture collection runner applies a backfill window before recalculating Inference", async () => {
    const store = new InMemoryCollectionStore();
    const collectionWindow = {
      since: new Date("2026-05-01T10:04:00.000Z"),
    };

    const summary = await runFixtureCollection({
      config: { databaseUrl: "postgres://localhost/slopwatch_fixture" },
      collectionWindow,
      storeFactory: () => store,
      inferenceStoreFactory: () => store,
    });

    expect(summary).toMatchObject({
      eventsProcessed: 1,
      workUnitsProcessed: 1,
      collectionWindow,
    });
    expect([...store.events.values()].map((event) => event.sourceLocator)).toEqual(
      ["fixture/codex-local-demo/session-001/fork-main/0003"],
    );
    expect([...store.inferences.values()]).toMatchObject([
      {
        state: "active",
        inferenceVersion: "work-unit-inference-v1",
      },
    ]);
  });

  test("real Codex collection runner uses healthy Sources and the shared normalization path", async () => {
    await expect(
      runCodexLocalCollection({
        config: {},
        storeFactory: () => new InMemoryCollectionStore(),
      }),
    ).rejects.toThrow("DATABASE_URL is required");

    const store = new InMemoryCollectionStore();
    const databaseUrls: string[] = [];
    const requestedSourcePaths: string[] = [];
    let collectionStoreClosed = false;

    const fixtureRecords = readFixtureSourceRecords().map((record) => ({
      ...record,
      source: {
        sourceKey: "codex-local:default",
        sourceType: "codex-local",
        path: "/sources/configured-codex",
        healthStatus: "ok",
      },
      event: {
        ...record.event,
        sourceLocator: record.event.sourceLocator.replace(
          "fixture/codex-local-demo",
          "sessions/2026/05/27/rollout-thread-main.jsonl",
        ),
        parserVersion: "codex-local-v0",
        sourceVersion: "0.134.0",
      },
    }));

    const summary = await runCodexLocalCollection({
      config: codexCollectionConfig(),
      env: { CODEX_HOME: "/sources/detected-codex" },
      sourceList: configuredCodexSourceList,
      sourceReader: async ({ source }) => {
        requestedSourcePaths.push(source.path);

        return fixtureRecords;
      },
      storeFactory: (databaseUrl) => {
        databaseUrls.push(databaseUrl);

        return Object.assign(store, {
          close: async () => {
            collectionStoreClosed = true;
          },
        });
      },
      inferenceStoreFactory: (databaseUrl) => {
        databaseUrls.push(databaseUrl);

        return store;
      },
    });

    expect(summary).toMatchObject({
      sourceKeys: ["codex-local:default"],
      eventsProcessed: 3,
      workUnitsProcessed: 1,
    });
    expect(requestedSourcePaths).toEqual(["/sources/configured-codex"]);
    expect(store.sources.size).toBe(1);
    expect(store.events.size).toBe(3);
    expect([...store.inferences.values()]).toMatchObject([
      {
        state: "active",
        inferenceVersion: "work-unit-inference-v1",
      },
    ]);
    expect(databaseUrls).toEqual([
      "postgres://localhost/slopwatch_codex",
      "postgres://localhost/slopwatch_codex",
    ]);
    expect(collectionStoreClosed).toBe(true);
  });

  test("real Codex collection runner infers Blocked from waiting evidence", async () => {
    const store = new InMemoryCollectionStore();
    const fixtureRecords = readFixtureSourceRecords().map((record) => ({
      ...record,
      source: {
        sourceKey: "codex-local:default",
        sourceType: "codex-local",
        path: "/sources/configured-codex",
        healthStatus: "ok",
      },
      workUnit: {
        ...record.workUnit,
        identityKey: "codex-local:default:thread-main",
      },
      event: {
        ...record.event,
        sourceLocator: record.event.sourceLocator.replace(
          "fixture/codex-local-demo/session-001/fork-main",
          "sessions/2026/05/27/rollout-thread-main.jsonl",
        ),
        metadata: record.event.sourceLocator.endsWith("/0003")
          ? {
              action: "waiting for approval",
              waitingFor: "approval",
              toolCalls: 1,
            }
          : record.event.metadata,
        parserVersion: "codex-local-v0",
        sourceVersion: "0.134.0",
      },
    }));

    const summary = await runCodexLocalCollection({
      config: codexCollectionConfig(),
      env: { CODEX_HOME: "/sources/detected-codex" },
      sourceList: configuredCodexSourceList,
      sourceReader: async () => fixtureRecords,
      storeFactory: () => store,
      inferenceStoreFactory: () => store,
    });

    expect(summary).toMatchObject({
      sourceKeys: ["codex-local:default"],
      eventsProcessed: 3,
      workUnitsProcessed: 1,
    });
    expect([...store.inferences.values()]).toMatchObject([
      {
        state: "blocked",
        explanation:
          "Blocked because the latest Event shows waiting for approval.",
      },
    ]);
    expect(
      [...store.events.values()].find((event) =>
        event.sourceLocator.endsWith("/0003"),
      )?.metadata,
    ).toMatchObject({
      action: "waiting for approval",
      waitingFor: "approval",
    });
  });

  test("real Codex collection runner infers Failed from terminal failure evidence", async () => {
    const store = new InMemoryCollectionStore();
    const fixtureRecords = readFixtureSourceRecords().map((record) => ({
      ...record,
      source: {
        sourceKey: "codex-local:default",
        sourceType: "codex-local",
        path: "/sources/configured-codex",
        healthStatus: "ok",
      },
      workUnit: {
        ...record.workUnit,
        identityKey: "codex-local:default:thread-main",
      },
      event: {
        ...record.event,
        sourceLocator: record.event.sourceLocator.replace(
          "fixture/codex-local-demo/session-001/fork-main",
          "sessions/2026/05/27/rollout-thread-main.jsonl",
        ),
        eventType: record.event.sourceLocator.endsWith("/0003")
          ? "error"
          : record.event.eventType,
        metadata: record.event.sourceLocator.endsWith("/0003")
          ? {
              action: "reported terminal failure",
              status: "failed",
              terminal: true,
              message: "Codex run failed before producing a final response.",
            }
          : record.event.metadata,
        parserVersion: "codex-local-v0",
        sourceVersion: "0.134.0",
      },
    }));

    const summary = await runCodexLocalCollection({
      config: codexCollectionConfig(),
      env: { CODEX_HOME: "/sources/detected-codex" },
      sourceList: configuredCodexSourceList,
      sourceReader: async () => fixtureRecords,
      storeFactory: () => store,
      inferenceStoreFactory: () => store,
    });

    expect(summary).toMatchObject({
      sourceKeys: ["codex-local:default"],
      eventsProcessed: 3,
      workUnitsProcessed: 1,
    });
    expect([...store.inferences.values()]).toMatchObject([
      {
        state: "failed",
        explanation:
          "Failed because the final Event has terminal failure evidence.",
      },
    ]);
    expect(
      [...store.events.values()].find((event) =>
        event.sourceLocator.endsWith("/0003"),
      ),
    ).toMatchObject({
      eventType: "error",
      metadata: {
        action: "reported terminal failure",
        status: "failed",
        terminal: true,
        message: "Codex run failed before producing a final response.",
      },
    });
  });

  test("real Codex collection runner infers Finished from completion evidence", async () => {
    const store = new InMemoryCollectionStore();
    const fixtureRecords = codexLocalFixtureRecords({
      finalEvent: {
        eventType: "task_completed",
        metadata: {
          action: "completed task",
          status: "finished",
          terminal: true,
          turnId: "turn-1",
          durationMs: 12345,
          timeToFirstTokenMs: 321,
        },
        rawPayload: "Private final assistant answer.",
        rawPayloadKind: "source_text",
      },
    });

    const summary = await runCodexLocalCollection({
      config: codexCollectionConfig(),
      env: { CODEX_HOME: "/sources/detected-codex" },
      sourceList: configuredCodexSourceList,
      sourceReader: async () => fixtureRecords,
      storeFactory: () => store,
      inferenceStoreFactory: () => store,
    });

    expect(summary).toMatchObject({
      sourceKeys: ["codex-local:default"],
      eventsProcessed: 3,
      workUnitsProcessed: 1,
    });
    expect([...store.inferences.values()]).toMatchObject([
      {
        state: "finished",
        explanation: "Finished because the final Event has completion evidence.",
      },
    ]);
    expect(
      [...store.events.values()].find((event) =>
        event.sourceLocator.endsWith("/0003"),
      ),
    ).toMatchObject({
      eventType: "task_completed",
      metadata: {
        action: "completed task",
        status: "finished",
        terminal: true,
        turnId: "turn-1",
        durationMs: 12345,
        timeToFirstTokenMs: 321,
      },
      rawPayload: null,
    });
  });

  test("real Codex collection runner recalculates Finished back to Active after later Events", async () => {
    const store = new InMemoryCollectionStore();
    const finishedRecords = codexLocalFixtureRecords({
      finalEvent: {
        eventType: "task_completed",
        metadata: {
          action: "completed task",
          status: "finished",
          terminal: true,
        },
      },
    });
    const lastFinishedRecord = finishedRecords.at(-1);

    if (!lastFinishedRecord) {
      throw new Error("Expected fixture records to include a final Event.");
    }

    await runCodexLocalCollection({
      config: codexCollectionConfig(),
      env: { CODEX_HOME: "/sources/detected-codex" },
      sourceList: configuredCodexSourceList,
      sourceReader: async () => finishedRecords,
      storeFactory: () => store,
      inferenceStoreFactory: () => store,
    });
    expect([...store.inferences.values()]).toMatchObject([
      {
        state: "finished",
      },
    ]);

    await runCodexLocalCollection({
      config: codexCollectionConfig(),
      env: { CODEX_HOME: "/sources/detected-codex" },
      sourceList: configuredCodexSourceList,
      sourceReader: async () => [
        ...finishedRecords,
        {
          ...lastFinishedRecord,
          event: {
            ...lastFinishedRecord.event,
            sourceLocator: "sessions/2026/05/27/rollout-thread-main.jsonl/0004",
            eventType: "assistant_message",
            observedAt: new Date("2026-05-01T10:05:00.000Z"),
            metadata: {
              action: "reported progress after completion",
            },
            rawPayload: null,
          },
        },
      ],
      storeFactory: () => store,
      inferenceStoreFactory: () => store,
    });

    expect([...store.inferences.values()]).toMatchObject([
      {
        state: "active",
        explanation:
          "Active because later activity arrived after completion evidence.",
      },
    ]);
    expect(store.events.size).toBe(4);
  });

  test("real Codex backfill deduplicates Source locators and preserves Event versions", async () => {
    const store = new InMemoryCollectionStore();
    const collectionWindow = {
      since: new Date("2026-05-01T10:02:00.000Z"),
    };
    let recordsVersion = 1;

    const readRecords = () =>
      readFixtureSourceRecords().map((record) => ({
        ...record,
        source: {
          sourceKey: "codex-local:default",
          sourceType: "codex-local",
          path: "/sources/configured-codex",
          healthStatus: "ok",
        },
        workUnit: {
          ...record.workUnit,
          identityKey: "codex-local:default:thread-main",
        },
        event: {
          ...record.event,
          sourceLocator: record.event.sourceLocator.replace(
            "fixture/codex-local-demo/session-001/fork-main",
            "sessions/2026/05/27/rollout-thread-main.jsonl",
          ),
          metadata: record.event.sourceLocator.endsWith("/0003")
            ? {
                ...record.event.metadata,
                summary: `Backfilled Codex activity v${recordsVersion}.`,
              }
            : record.event.metadata,
          parserVersion: `codex-local-v${recordsVersion}`,
          sourceVersion: `0.134.${recordsVersion}`,
        },
      }));

    const summary = await runCodexLocalCollection({
      config: codexCollectionConfig(),
      env: { CODEX_HOME: "/sources/detected-codex" },
      collectionWindow,
      sourceList: configuredCodexSourceList,
      sourceReader: async () => readRecords(),
      storeFactory: () => store,
      inferenceStoreFactory: () => store,
    });
    const firstEventIds = [...store.events.values()].map((event) => event.id);

    expect(summary).toMatchObject({
      sourceKeys: ["codex-local:default"],
      eventsProcessed: 2,
      workUnitsProcessed: 1,
      collectionWindow,
    });
    expect([...store.events.values()].map((event) => event.sourceLocator)).toEqual(
      [
        "sessions/2026/05/27/rollout-thread-main.jsonl/0002",
        "sessions/2026/05/27/rollout-thread-main.jsonl/0003",
      ],
    );

    recordsVersion = 2;
    await runCodexLocalCollection({
      config: codexCollectionConfig(),
      env: { CODEX_HOME: "/sources/detected-codex" },
      collectionWindow,
      sourceList: configuredCodexSourceList,
      sourceReader: async () => readRecords(),
      storeFactory: () => store,
      inferenceStoreFactory: () => store,
    });

    expect(store.events.size).toBe(2);
    expect([...store.events.values()].map((event) => event.id)).toEqual(
      firstEventIds,
    );

    const updatedEvent = [...store.events.values()].find((event) =>
      event.sourceLocator.endsWith("/0003"),
    );
    expect(updatedEvent?.metadata).toMatchObject({
      summary: "Backfilled Codex activity v2.",
    });
    expect(updatedEvent?.parserVersion).toBe("codex-local-v2");
    expect(updatedEvent?.sourceVersion).toBe("0.134.2");
    expect([...store.inferences.values()]).toMatchObject([
      {
        state: "active",
        inferenceVersion: "work-unit-inference-v1",
      },
    ]);
  });

  test("real Codex backfill reports no affected WorkUnits when no Events match the window", async () => {
    const store = new InMemoryCollectionStore();

    const summary = await runCodexLocalCollection({
      config: codexCollectionConfig(),
      env: { CODEX_HOME: "/sources/detected-codex" },
      collectionWindow: {
        since: new Date("2026-05-01T11:00:00.000Z"),
      },
      sourceList: configuredCodexSourceList,
      sourceReader: async () => readFixtureSourceRecords(),
      storeFactory: () => store,
      inferenceStoreFactory: () => store,
    });

    expect(summary).toMatchObject({
      eventsProcessed: 0,
      workUnitsProcessed: 0,
      workUnitIds: [],
    });
    expect(store.events.size).toBe(0);
    expect(store.inferences.size).toBe(0);
  });

  test("real Codex collection links a child Fork to an already persisted origin Fork", async () => {
    const store = new InMemoryCollectionStore();
    const [parentRecord, childRecord] = codexForkRelationshipRecords();

    if (!parentRecord || !childRecord) {
      throw new Error("Expected parent and child Fork records.");
    }

    await collectCodexRecords({ store, records: [parentRecord] });
    const parentFork = findForkBySourceForkId(store, "thread-parent");

    const summary = await collectCodexRecords({
      store,
      records: [childRecord],
    });

    expect(summary).toMatchObject({
      sourceKeys: ["codex-local:default"],
      eventsProcessed: 1,
      workUnitsProcessed: 1,
    });
    expect(store.forks.size).toBe(2);
    expect(store.workUnits.size).toBe(2);
    expect(store.events.size).toBe(2);

    const childFork = findForkBySourceForkId(store, "thread-child");

    expect(parentFork?.originForkId).toBeNull();
    expect(childFork?.originForkId).toBe(parentFork?.id);
  });

  test("real Codex collection preserves unresolved Source origin when child Fork appears first", async () => {
    const store = new InMemoryCollectionStore();
    const [, childRecord] = codexForkRelationshipRecords();

    if (!childRecord) {
      throw new Error("Expected child Fork record.");
    }

    await collectCodexRecords({ store, records: [childRecord] });

    const childWorkUnit = findWorkUnitByIdentityKey(
      store,
      "codex-local:default:thread-child",
    );

    if (!childWorkUnit) {
      throw new Error("Expected child Fork WorkUnit to be persisted.");
    }

    const childDetail = await getAgentDetail({
      store,
      workUnitId: childWorkUnit.id,
    });

    expect(childDetail?.forkOrigin).toEqual({
      sourceForkId: "thread-child",
      originForkId: "thread-parent",
      originStatus: "unresolved",
      originWorkUnitId: null,
    });
  });

  test("later Codex collection resolves a previously unresolved child Fork origin without rekeying the child WorkUnit", async () => {
    const store = new InMemoryCollectionStore();
    const [parentRecord, childRecord] = codexForkRelationshipRecords();

    if (!parentRecord || !childRecord) {
      throw new Error("Expected parent and child Fork records.");
    }

    await collectCodexRecords({ store, records: [childRecord] });

    const childWorkUnitBefore = findWorkUnitByIdentityKey(
      store,
      "codex-local:default:thread-child",
    );
    const childForkBefore = findForkBySourceForkId(store, "thread-child");

    if (!childWorkUnitBefore || !childForkBefore) {
      throw new Error("Expected child Fork and WorkUnit to be persisted.");
    }

    await collectCodexRecords({ store, records: [parentRecord] });

    const parentFork = findForkBySourceForkId(store, "thread-parent");
    const parentWorkUnit = findWorkUnitByIdentityKey(
      store,
      "codex-local:default:thread-parent",
    );
    const childForkAfter = findForkBySourceForkId(store, "thread-child");
    const childWorkUnitAfter = findWorkUnitByIdentityKey(
      store,
      "codex-local:default:thread-child",
    );

    expect(store.forks.size).toBe(2);
    expect(store.workUnits.size).toBe(2);
    expect(childForkAfter?.id).toBe(childForkBefore.id);
    expect(childWorkUnitAfter?.id).toBe(childWorkUnitBefore.id);
    expect(childForkAfter?.originForkId).toBe(parentFork?.id);

    const childDetail = await getAgentDetail({
      store,
      workUnitId: childWorkUnitBefore.id,
    });

    expect(childDetail?.forkOrigin).toEqual({
      sourceForkId: "thread-child",
      originForkId: "thread-parent",
      originStatus: "resolved",
      originWorkUnitId: parentWorkUnit?.id,
    });
  });

  test("rerunning deferred Fork origin collection remains idempotent after resolution", async () => {
    const store = new InMemoryCollectionStore();
    const [parentRecord, childRecord] = codexForkRelationshipRecords();

    if (!parentRecord || !childRecord) {
      throw new Error("Expected parent and child Fork records.");
    }

    await collectCodexRecords({ store, records: [childRecord] });
    await collectCodexRecords({ store, records: [parentRecord] });

    const forkIds = [...store.forks.values()].map((fork) => fork.id);
    const workUnitIds = [...store.workUnits.values()].map(
      (workUnit) => workUnit.id,
    );
    const eventIds = [...store.events.values()].map((event) => event.id);
    const childWorkUnit = findWorkUnitByIdentityKey(
      store,
      "codex-local:default:thread-child",
    );
    const parentFork = findForkBySourceForkId(store, "thread-parent");

    await collectCodexRecords({ store, records: [childRecord] });
    await collectCodexRecords({ store, records: [parentRecord] });

    expect([...store.forks.values()].map((fork) => fork.id)).toEqual(forkIds);
    expect([...store.workUnits.values()].map((workUnit) => workUnit.id)).toEqual(
      workUnitIds,
    );
    expect([...store.events.values()].map((event) => event.id)).toEqual(
      eventIds,
    );
    expect(store.forks.size).toBe(2);
    expect(store.workUnits.size).toBe(2);
    expect(store.events.size).toBe(2);
    expect(findWorkUnitByIdentityKey(store, "codex-local:default:thread-child")?.id).toBe(
      childWorkUnit?.id,
    );
    expect(findForkBySourceForkId(store, "thread-child")?.originForkId).toBe(
      parentFork?.id,
    );
  });

  test("linked Codex Forks remain separate Now Agents and child detail maps the Source relationship", async () => {
    const store = new InMemoryCollectionStore();
    const records = codexForkRelationshipRecords();

    await collectCodexRecords({ store, records });

    const projection = await getNowProjection({
      store,
      now: new Date("2026-05-27T10:02:00.000Z"),
    });
    const activeAgents =
      projection.groups.find((group) => group.key === "active")?.agents ?? [];

    expect(activeAgents).toHaveLength(2);
    expect(activeAgents.map((agent) => agent.project.displayName)).toEqual([
      "slopwatch-demo",
      "slopwatch-demo",
    ]);
    expect(activeAgents.map((agent) => agent.workUnitId)).toEqual(
      expect.arrayContaining([...store.workUnits.values()].map(({ id }) => id)),
    );

    const childWorkUnit = findWorkUnitByIdentityKey(
      store,
      "codex-local:default:thread-child",
    );

    if (!childWorkUnit) {
      throw new Error("Expected child Fork WorkUnit to be persisted.");
    }

    const childDetail = await getAgentDetail({
      store,
      workUnitId: childWorkUnit.id,
    });

    expect(childDetail?.forkOrigin).toEqual({
      sourceForkId: "thread-child",
      originForkId: "thread-parent",
      originStatus: "resolved",
      originWorkUnitId: findWorkUnitByIdentityKey(
        store,
        "codex-local:default:thread-parent",
      )?.id,
    });
    expect(childDetail?.events[0]?.source.sourceLocator).toBe(
      "sessions/2026/05/27/rollout-thread-child.jsonl:1",
    );
  });

  test("repeated Codex collection preserves linked Fork relationships without duplication", async () => {
    const store = new InMemoryCollectionStore();
    const records = codexForkRelationshipRecords();

    await collectCodexRecords({ store, records });

    const parentFork = findForkBySourceForkId(store, "thread-parent");

    if (!parentFork) {
      throw new Error("Expected parent Fork to be persisted.");
    }

    const forkIds = [...store.forks.values()].map((fork) => fork.id);
    const workUnitIds = [...store.workUnits.values()].map(
      (workUnit) => workUnit.id,
    );
    const eventIds = [...store.events.values()].map((event) => event.id);

    await collectCodexRecords({ store, records });

    expect([...store.forks.values()].map((fork) => fork.id)).toEqual(forkIds);
    expect([...store.workUnits.values()].map((workUnit) => workUnit.id)).toEqual(
      workUnitIds,
    );
    expect([...store.events.values()].map((event) => event.id)).toEqual(
      eventIds,
    );
    expect(store.forks.size).toBe(2);
    expect(store.workUnits.size).toBe(2);
    expect(store.events.size).toBe(2);
    expect(findForkBySourceForkId(store, "thread-child")?.originForkId).toBe(
      parentFork.id,
    );
  });
});
