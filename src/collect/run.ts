import type { RuntimeConfig } from "../config/runtime";
import { MissingDatabaseUrlError } from "../db/migrations";
import { createPostgresInferenceStore } from "../infer/postgres-store";
import {
  runWorkUnitInference,
  type InferenceStore,
} from "../infer/work-unit";
import { collectFixtureSource, type CollectionStore } from "./fixture";
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
