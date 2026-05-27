import { constants } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import type {
  RuntimeConfig,
  RuntimeEnv,
  SourceConfig,
} from "../config/runtime";

export type SourceOrigin = "detected" | "configured";
export type SourceHealthStatus = "ok" | "missing" | "unreadable" | "malformed";

export type SourceHealth = {
  status: SourceHealthStatus;
  message?: string;
};

export type SourceCheck = {
  health: SourceHealth;
  format: SourceHealth;
};

export type SourceReport = {
  sourceKey: string;
  sourceType: string;
  path: string;
  origin: SourceOrigin;
  overridden: boolean;
  health: SourceHealth;
  format: SourceHealth;
};

export type SourceDetector = {
  detect: (env: RuntimeEnv) => Promise<SourceConfig[]>;
};

export type SourceHealthChecker = {
  check: (source: SourceConfig) => Promise<SourceCheck | SourceHealth>;
};

export type ListSourcesInput = {
  config?: RuntimeConfig;
  env?: RuntimeEnv;
  detectors?: SourceDetector[];
  healthChecker?: SourceHealthChecker;
};

export async function listSources({
  config = {},
  env = {},
  detectors = [createCodexLocalSourceDetector()],
  healthChecker = createLocalSourceHealthChecker(),
}: ListSourcesInput = {}): Promise<SourceReport[]> {
  const detectedSources = (
    await Promise.all(detectors.map((detector) => detector.detect(env)))
  ).flat();
  const reports = new Map<string, SourceReport>();

  for (const source of detectedSources) {
    const normalized = normalizeSourceConfig(source);
    const sourceCheck = normalizeSourceCheck(
      await healthChecker.check(normalized),
    );

    reports.set(normalized.sourceKey, {
      ...normalized,
      origin: "detected",
      overridden: false,
      health: sourceCheck.health,
      format: sourceCheck.format,
    });
  }

  for (const source of config.sources ?? []) {
    const normalized = normalizeSourceConfig(source);
    const sourceCheck = normalizeSourceCheck(
      await healthChecker.check(normalized),
    );

    reports.set(normalized.sourceKey, {
      ...normalized,
      origin: "configured",
      overridden: reports.has(normalized.sourceKey),
      health: sourceCheck.health,
      format: sourceCheck.format,
    });
  }

  return [...reports.values()].sort((left, right) =>
    left.sourceKey.localeCompare(right.sourceKey),
  );
}

export function createCodexLocalSourceDetector(): SourceDetector {
  return {
    detect: async (env) => [
      {
        sourceKey: "codex-local:default",
        sourceType: "codex-local",
        path: env.CODEX_HOME ?? join(env.HOME ?? process.cwd(), ".codex"),
      },
    ],
  };
}

export function createLocalSourceHealthChecker(): SourceHealthChecker {
  return {
    check: async (source) => {
      try {
        const sourceStat = await stat(source.path);

        if (!sourceStat.isDirectory()) {
          return {
            status: "malformed",
            message: "Source path exists but is not a directory.",
          };
        }

        await access(source.path, constants.R_OK);

        return {
          health: {
            status: "ok",
          },
          format: await checkSourceFormat(source),
        };
      } catch (error) {
        if (isNotFoundError(error)) {
          return {
            health: {
              status: "missing",
              message: "Source path does not exist.",
            },
            format: {
              status: "missing",
              message: "Source path does not exist.",
            },
          };
        }

        const message = error instanceof Error ? error.message : String(error);

        return {
          health: {
            status: "unreadable",
            message,
          },
          format: {
            status: "unreadable",
            message,
          },
        };
      }
    },
  };
}

export function normalizeSourceConfig(
  source: SourceConfig,
): Required<SourceConfig> {
  return {
    sourceKey: source.sourceKey ?? `${source.sourceType}:${source.path}`,
    sourceType: source.sourceType,
    path: source.path,
  };
}

async function checkSourceFormat(source: SourceConfig): Promise<SourceHealth> {
  if (source.sourceType !== "codex-local") {
    return {
      status: "ok",
    };
  }

  // v0 macOS Codex Sources are rooted at $CODEX_HOME, otherwise ~/.codex.
  // The confirmed readable format is state_5.sqlite plus rollout JSONL files
  // under sessions/YYYY/MM/DD/.
  if (
    (await isFile(join(source.path, "state_5.sqlite"))) &&
    (await containsRolloutJsonl(join(source.path, "sessions")))
  ) {
    return {
      status: "ok",
    };
  }

  return {
    status: "malformed",
    message:
      "Codex local Source must contain state_5.sqlite and sessions/YYYY/MM/DD/rollout-*.jsonl.",
  };
}

function normalizeSourceCheck(result: SourceCheck | SourceHealth): SourceCheck {
  if ("health" in result && "format" in result) {
    return result;
  }

  return {
    health: result,
    format: result.status === "ok" ? { status: "ok" } : result,
  };
}

async function isDirectory(path: string) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(path: string) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function containsRolloutJsonl(path: string): Promise<boolean> {
  try {
    const entries = await readdir(path, { withFileTypes: true });

    for (const entry of entries) {
      if (
        entry.isFile() &&
        entry.name.startsWith("rollout-") &&
        entry.name.endsWith(".jsonl")
      ) {
        return true;
      }

      if (
        entry.isDirectory() &&
        (await containsRolloutJsonl(join(path, entry.name)))
      ) {
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
}

function isNotFoundError(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
