import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { RuntimeConfig, SourceConfig } from "./runtime";

export type UserConfigReadResult =
  | {
      status: "ok";
      config: Partial<RuntimeConfig>;
    }
  | {
      status: "missing";
      config: Partial<RuntimeConfig>;
    }
  | {
      status: "malformed";
      config: Partial<RuntimeConfig>;
      message: string;
    };

export function defaultUserConfigPath() {
  return join(homedir(), ".config", "slopwatch", "config.json");
}

export async function readUserConfig(
  configPath = defaultUserConfigPath(),
): Promise<UserConfigReadResult> {
  try {
    return {
      status: "ok",
      config: parseUserConfig(await readFile(configPath, "utf8")),
    };
  } catch (error) {
    if (isNotFoundError(error)) {
      return {
        status: "missing",
        config: {},
      };
    }

    return {
      status: "malformed",
      config: {},
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function writeUserConfig(
  config: Partial<RuntimeConfig>,
  configPath = defaultUserConfigPath(),
) {
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, serializeUserConfig(config), "utf8");
}

export async function removeUserConfig(
  configPath = defaultUserConfigPath(),
) {
  await rm(configPath, { force: true });
}

export function serializeUserConfig(config: Partial<RuntimeConfig>) {
  const serialized: {
    databaseUrl?: string;
    sources: SourceConfig[];
  } = {
    sources: config.sources ?? [],
  };

  if (config.databaseUrl) {
    serialized.databaseUrl = config.databaseUrl;
  }

  return `${JSON.stringify(serialized, null, 2)}\n`;
}

function parseUserConfig(rawConfig: string): Partial<RuntimeConfig> {
  const parsed: unknown = JSON.parse(rawConfig);

  if (!isRecord(parsed)) {
    throw new Error("Slopwatch config must be a JSON object.");
  }

  const config: Partial<RuntimeConfig> = {};

  if (parsed.databaseUrl !== undefined) {
    if (typeof parsed.databaseUrl !== "string") {
      throw new Error("databaseUrl must be a string.");
    }

    config.databaseUrl = parsed.databaseUrl;
  }

  if (parsed.sources !== undefined) {
    if (!Array.isArray(parsed.sources)) {
      throw new Error("sources must be an array.");
    }

    config.sources = parsed.sources.map(parseSourceConfig);
  }

  return config;
}

function parseSourceConfig(source: unknown): SourceConfig {
  if (!isRecord(source)) {
    throw new Error("Each Source config must be an object.");
  }

  if (typeof source.sourceType !== "string") {
    throw new Error("Source sourceType must be a string.");
  }

  if (typeof source.path !== "string") {
    throw new Error("Source path must be a string.");
  }

  if (
    source.sourceKey !== undefined &&
    typeof source.sourceKey !== "string"
  ) {
    throw new Error("Source sourceKey must be a string.");
  }

  return {
    sourceKey: source.sourceKey,
    sourceType: source.sourceType,
    path: source.path,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNotFoundError(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
