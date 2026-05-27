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
import type { CollectionWindow } from "./window";

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
  collectionWindow?: CollectionWindow;
};

export async function runFixtureCollection({
  config,
  storeFactory = createPostgresCollectionStore,
  inferenceStoreFactory = createPostgresInferenceStore,
  includeContent = false,
  collectionWindow,
}: {
  config: RuntimeConfig;
  storeFactory?: CollectionStoreFactory;
  inferenceStoreFactory?: InferenceStoreFactory;
  includeContent?: boolean;
  collectionWindow?: CollectionWindow;
}) {
  if (!config.databaseUrl) {
    throw new MissingDatabaseUrlError();
  }

  const store = storeFactory(config.databaseUrl);
  let inferenceStore: CloseableInferenceStore | undefined;

  try {
    const summary = await collectFixtureSource({
      store,
      includeContent,
      collectionWindow,
    });
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
  collectionWindow,
  sourceList = listSources,
  sourceReader = readCodexLocalSourceRecords,
}: {
  config: RuntimeConfig;
  env?: RuntimeEnv;
  storeFactory?: CollectionStoreFactory;
  inferenceStoreFactory?: InferenceStoreFactory;
  includeContent?: boolean;
  collectionWindow?: CollectionWindow;
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
        collectionWindow,
      });

      eventsProcessed += summary.eventsProcessed;
      summary.workUnitIds.forEach((workUnitId) => workUnitIds.add(workUnitId));
    }

    inferenceStore = inferenceStoreFactory(config.databaseUrl);

    for (const workUnitId of workUnitIds) {
      await runWorkUnitInference({ store: inferenceStore, workUnitId });
    }

    return {
      sourceKeys: sources.map((source) => source.sourceKey),
      eventsProcessed,
      workUnitsProcessed: workUnitIds.size,
      workUnitIds: [...workUnitIds],
      collectionWindow,
    };
  } finally {
    await inferenceStore?.close?.();
    await store.close?.();
  }
}
