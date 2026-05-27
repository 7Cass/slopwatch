import type { RuntimeConfig } from "../config/runtime";
import { MissingDatabaseUrlError } from "../db/migrations";
import { collectFixtureSource, type CollectionStore } from "./fixture";
import { createPostgresCollectionStore } from "./postgres-store";

export type CloseableCollectionStore = CollectionStore & {
  close?: () => Promise<void>;
};

export type CollectionStoreFactory = (
  databaseUrl: string,
) => CloseableCollectionStore;

export async function runFixtureCollection({
  config,
  storeFactory = createPostgresCollectionStore,
  includeContent = false,
}: {
  config: RuntimeConfig;
  storeFactory?: CollectionStoreFactory;
  includeContent?: boolean;
}) {
  if (!config.databaseUrl) {
    throw new MissingDatabaseUrlError();
  }

  const store = storeFactory(config.databaseUrl);

  try {
    return await collectFixtureSource({ store, includeContent });
  } finally {
    await store.close?.();
  }
}
