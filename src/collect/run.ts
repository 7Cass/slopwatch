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
}: {
  config: RuntimeConfig;
  storeFactory?: CollectionStoreFactory;
}) {
  if (!config.databaseUrl) {
    throw new MissingDatabaseUrlError();
  }

  const store = storeFactory(config.databaseUrl);

  try {
    return await collectFixtureSource({ store });
  } finally {
    await store.close?.();
  }
}
