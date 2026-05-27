import type { RuntimeConfig } from "../config/runtime";
import type { RuntimeEnv, SourceConfig } from "../config/runtime";
import { MissingDatabaseUrlError } from "../db/migrations";
import { createPostgresInferenceStore } from "../infer/postgres-store";
import {
  runWorkUnitInference,
  type InferenceStore,
} from "../infer/work-unit";
import {
  collectFixtureSource,
  collectSourceRecords,
  type CollectionStore,
  type SourceRecord,
} from "./fixture";
import { listSources } from "../admin/sources";
import { readCodexLocalSourceRecords } from "./codex-local";
import { createPostgresCollectionStore } from "./postgres-store";

export type CloseableCollectionStore = CollectionStore & {
  close?: () => Promise<void>;
};

export type CollectionStoreFactory = (
  databaseUrl: string,
) => CloseableCollectionStore;

export type CloseableInferenceStore = InferenceStore & {
  close?: () => Promise<void>;
};

export type InferenceStoreFactory = (
  databaseUrl: string,
) => CloseableInferenceStore;

export type CodexLocalSourceReader = ({
  source,
}: {
  source: SourceConfig;
}) => Promise<SourceRecord[]>;

export type CodexLocalCollectionSummary = {
  sourceKeys: string[];
  eventsProcessed: number;
  workUnitsProcessed: number;
  workUnitIds: string[];
};

export async function runFixtureCollection({
  config,
  storeFactory = createPostgresCollectionStore,
  inferenceStoreFactory = createPostgresInferenceStore,
  includeContent = false,
}: {
  config: RuntimeConfig;
  storeFactory?: CollectionStoreFactory;
  inferenceStoreFactory?: InferenceStoreFactory;
  includeContent?: boolean;
}) {
  if (!config.databaseUrl) {
    throw new MissingDatabaseUrlError();
  }

  const store = storeFactory(config.databaseUrl);
  let inferenceStore: CloseableInferenceStore | undefined;

  try {
    const summary = await collectFixtureSource({ store, includeContent });
    inferenceStore = inferenceStoreFactory(config.databaseUrl);

    for (const workUnitId of summary.workUnitIds) {
      await runWorkUnitInference({ store: inferenceStore, workUnitId });
    }

    return summary;
  } finally {
    await inferenceStore?.close?.();
    await store.close?.();
  }
}

export async function runCodexLocalCollection({
  config,
  env = Bun.env,
  storeFactory = createPostgresCollectionStore,
  inferenceStoreFactory = createPostgresInferenceStore,
  includeContent = false,
  sourceList = listSources,
  sourceReader = readCodexLocalSourceRecords,
}: {
  config: RuntimeConfig;
  env?: RuntimeEnv;
  storeFactory?: CollectionStoreFactory;
  inferenceStoreFactory?: InferenceStoreFactory;
  includeContent?: boolean;
  sourceList?: typeof listSources;
  sourceReader?: CodexLocalSourceReader;
}): Promise<CodexLocalCollectionSummary> {
  if (!config.databaseUrl) {
    throw new MissingDatabaseUrlError();
  }

  const store = storeFactory(config.databaseUrl);
  let inferenceStore: CloseableInferenceStore | undefined;

  try {
    const sources = (
      await sourceList({
        config,
        env,
      })
    ).filter(
      (source) =>
        source.sourceType === "codex-local" &&
        source.health.status === "ok" &&
        source.format.status === "ok",
    );
    const workUnitIds = new Set<string>();
    const workUnitKeys = new Set<string>();
    let eventsProcessed = 0;

    for (const source of sources) {
      const records = await sourceReader({ source });

      if (records.length === 0) {
        continue;
      }

      const summary = await collectSourceRecords({
        store,
        records,
        includeContent,
      });

      eventsProcessed += summary.eventsProcessed;
      summary.workUnitIds.forEach((workUnitId) => workUnitIds.add(workUnitId));
      records.forEach((record) =>
        workUnitKeys.add(record.workUnit.identityKey),
      );
    }

    inferenceStore = inferenceStoreFactory(config.databaseUrl);

    for (const workUnitId of workUnitIds) {
      await runWorkUnitInference({ store: inferenceStore, workUnitId });
    }

    return {
      sourceKeys: sources.map((source) => source.sourceKey),
      eventsProcessed,
      workUnitsProcessed: workUnitKeys.size,
      workUnitIds: [...workUnitIds],
    };
  } finally {
    await inferenceStore?.close?.();
    await store.close?.();
  }
}
