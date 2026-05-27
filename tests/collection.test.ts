import { describe, expect, test } from "bun:test";

import {
  collectSourceRecords,
  collectFixtureSource,
  readFixtureSourceRecords,
  type CollectionStore,
  type StoredEvent,
  type StoredFork,
  type StoredProject,
  type StoredSession,
  type StoredSource,
  type StoredWorkUnit,
} from "../src/collect/fixture";
import { runFixtureCollection } from "../src/collect/run";

class InMemoryCollectionStore implements CollectionStore {
  private nextId = 1;
  readonly sources = new Map<string, StoredSource>();
  readonly projects = new Map<string, StoredProject>();
  readonly sessions = new Map<string, StoredSession>();
  readonly forks = new Map<string, StoredFork>();
  readonly workUnits = new Map<string, StoredWorkUnit>();
  readonly events = new Map<string, StoredEvent>();

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

  private allocateId() {
    return String(this.nextId++);
  }
}

describe("fixture collection", () => {
  test("writes deterministic fixture Events and domain identity", async () => {
    const store = new InMemoryCollectionStore();

    const summary = await collectFixtureSource({ store });

    expect(summary).toEqual({
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
    expect([...store.workUnits.values()][0]?.identityKey).toBe(
      "fixture:codex-local-demo:session-001:fork-main",
    );
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
    });

    expect(summary.eventsProcessed).toBe(3);
    expect(databaseUrls).toEqual(["postgres://localhost/slopwatch_fixture"]);
    expect(closed).toBe(true);
  });
});
