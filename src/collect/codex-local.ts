import { Database } from "bun:sqlite";
import { readFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";

import type { SourceConfig } from "../config/runtime";
import type { SourceRecord } from "./fixture";

export const codexLocalParserVersion = "codex-local-v0";

type ReadCodexLocalSourceInput = {
  source: SourceConfig;
};

type CodexThreadRow = {
  id: string;
  rollout_path: string;
  created_at_ms: number | null;
  updated_at_ms: number | null;
  cwd: string;
  source: string;
  model_provider: string;
  cli_version: string;
  git_sha: string | null;
  git_branch: string | null;
  git_origin_url: string | null;
  model: string | null;
  thread_source: string | null;
};

type CodexRolloutRecord = {
  timestamp?: unknown;
  type?: unknown;
  payload?: unknown;
};

type CodexThreadSpawnEdgeRow = {
  parent_thread_id: string;
  child_thread_id: string;
};

type ParsedCodexEvent = {
  sourceLocator: string;
  eventType: string;
  observedAt: Date;
  metadata: Record<string, unknown>;
  rawPayload?: string | null;
  rawPayloadKind?: "source_text";
};

// Confirmed v0 macOS Codex Source format:
// Source root is $CODEX_HOME when set, otherwise ~/.codex. The adapter reads
// state_5.sqlite for thread identity/metadata and sessions/YYYY/MM/DD/
// rollout-*.jsonl for the event stream. It must not write to Codex-owned files.
export async function readCodexLocalSourceRecords({
  source,
}: ReadCodexLocalSourceInput): Promise<SourceRecord[]> {
  const normalizedSource = normalizeSource(source);
  const sourceVersion = await readCodexSourceVersion(normalizedSource.path);
  const { threads, spawnEdges } = readThreadMetadataReadOnly(
    normalizedSource.path,
  );
  const records: SourceRecord[] = [];

  for (const thread of threads) {
    const rolloutPath = absoluteRolloutPath(normalizedSource.path, thread);
    const rolloutRelativePath = relative(normalizedSource.path, rolloutPath);
    const parsedEvents = await readRolloutEvents({
      rolloutPath,
      rolloutRelativePath,
    });

    if (parsedEvents.length === 0) {
      continue;
    }

    const firstObservedAt = earliestDate(
      parsedEvents.map((event) => event.observedAt),
      dateFromMs(thread.created_at_ms),
    );
    const lastObservedAt = latestDate(
      parsedEvents.map((event) => event.observedAt),
      dateFromMs(thread.updated_at_ms),
    );
    const projectRoot = thread.cwd || normalizedSource.path;
    const commonSource = {
      sourceKey: normalizedSource.sourceKey,
      sourceType: normalizedSource.sourceType,
      path: normalizedSource.path,
      healthStatus: "ok",
    };
    const commonProject = {
      projectKey: `local:${projectRoot}`,
      rootPath: projectRoot,
      displayName: basename(projectRoot),
    };
    const commonSession = {
      sourceSessionId: thread.id,
      startedAt: firstObservedAt,
      lastObservedAt,
    };
    const commonFork = {
      sourceForkId: thread.id,
      originForkId: spawnEdges.get(thread.id) ?? null,
      startedAt: firstObservedAt,
      lastObservedAt,
    };
    const commonWorkUnit = {
      identityKey: `${normalizedSource.sourceKey}:${thread.id}`,
      firstObservedAt,
      lastObservedAt,
    };
    const detectedSourceVersion = sourceVersion ?? (thread.cli_version || null);

    for (const event of parsedEvents) {
      records.push({
        source: commonSource,
        project: commonProject,
        session: commonSession,
        fork: commonFork,
        workUnit: commonWorkUnit,
        event: {
          ...event,
          metadata: enrichMetadata(event.metadata, thread),
          rawPayload: event.rawPayload ?? null,
          parserVersion: codexLocalParserVersion,
          sourceVersion: detectedSourceVersion,
        },
      });
    }
  }

  return records;
}

function readThreadMetadataReadOnly(sourcePath: string): {
  threads: CodexThreadRow[];
  spawnEdges: Map<string, string>;
} {
  const database = new Database(join(sourcePath, "state_5.sqlite"), {
    readonly: true,
  });

  try {
    const threads = database
      .query(
        `
          select
            id,
            rollout_path,
            created_at_ms,
            updated_at_ms,
            cwd,
            source,
            model_provider,
            cli_version,
            git_sha,
            git_branch,
            git_origin_url,
            model,
            thread_source
          from threads
          order by updated_at_ms asc, id asc
        `,
      )
      .all() as CodexThreadRow[];
    const edges = database
      .query(
        `
          select
            parent_thread_id,
            child_thread_id
          from thread_spawn_edges
        `,
      )
      .all() as CodexThreadSpawnEdgeRow[];

    return {
      threads,
      spawnEdges: new Map(
        edges.map((edge) => [edge.child_thread_id, edge.parent_thread_id]),
      ),
    };
  } finally {
    database.close();
  }
}

async function readRolloutEvents({
  rolloutPath,
  rolloutRelativePath,
}: {
  rolloutPath: string;
  rolloutRelativePath: string;
}): Promise<ParsedCodexEvent[]> {
  const raw = await readFile(rolloutPath, "utf8");
  const events: ParsedCodexEvent[] = [];

  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    if (!line.trim()) {
      continue;
    }

    const parsed = parseRolloutRecord(line);
    const event = parsed
      ? toSourceEvent(parsed, `${rolloutRelativePath}:${index + 1}`)
      : null;

    if (event) {
      events.push(event);
    }
  }

  return events;
}

function toSourceEvent(
  record: CodexRolloutRecord,
  sourceLocator: string,
): ParsedCodexEvent | null {
  const payload = asRecord(record.payload);
  const observedAt = dateFromUnknown(record.timestamp) ?? new Date(0);
  const recordType = typeof record.type === "string" ? record.type : "unknown";
  const payloadType =
    typeof payload.type === "string" ? payload.type : undefined;

  if (recordType === "session_meta") {
    return {
      sourceLocator,
      eventType: "session_started",
      observedAt,
      metadata: {
        action: "started session",
        cwd: stringValue(payload.cwd),
        source: stringValue(payload.source),
        threadSource: stringValue(payload.thread_source),
        modelProvider: stringValue(payload.model_provider),
      },
      rawPayload: null,
    };
  }

  if (recordType === "event_msg" && payloadType === "task_started") {
    return {
      sourceLocator,
      eventType: "task_started",
      observedAt:
        dateFromUnknown(payload.started_at) ??
        dateFromUnknown(record.timestamp) ??
        new Date(0),
      metadata: {
        action: "started task",
        turnId: stringValue(payload.turn_id),
      },
      rawPayload: null,
    };
  }

  if (recordType === "event_msg" && payloadType === "user_message") {
    return {
      sourceLocator,
      eventType: "user_message",
      observedAt,
      metadata: {
        action: "received user message",
      },
      rawPayload: stringValue(payload.message) ?? null,
      rawPayloadKind: "source_text",
    };
  }

  if (recordType === "event_msg" && payloadType === "agent_message") {
    return {
      sourceLocator,
      eventType: "assistant_message",
      observedAt,
      metadata: {
        action: "sent assistant message",
        phase: stringValue(payload.phase),
      },
      rawPayload: stringValue(payload.message) ?? null,
      rawPayloadKind: "source_text",
    };
  }

  if (recordType === "response_item" && payloadType === "function_call") {
    const argumentsMetadata = parseFunctionArguments(payload.arguments);

    return {
      sourceLocator,
      eventType: "tool_call",
      observedAt,
      metadata: {
        action: "called tool",
        toolName: stringValue(payload.name),
        callId: stringValue(payload.call_id),
        command: stringValue(argumentsMetadata.cmd ?? argumentsMetadata.command),
        toolCalls: 1,
      },
      rawPayload: null,
    };
  }

  if (recordType === "response_item" && payloadType === "message") {
    return messageResponseItemEvent({
      payload,
      observedAt,
      sourceLocator,
    });
  }

  if (
    recordType === "response_item" &&
    payloadType === "function_call_output"
  ) {
    return {
      sourceLocator,
      eventType: "tool_result",
      observedAt,
      metadata: {
        action: "reported tool result",
        callId: stringValue(payload.call_id),
      },
      rawPayload: stringValue(payload.output) ?? null,
      rawPayloadKind: "source_text",
    };
  }

  if (recordType === "event_msg" && payloadType === "token_count") {
    return {
      sourceLocator,
      eventType: "token_count",
      observedAt,
      metadata: tokenCountMetadata(payload.info),
      rawPayload: null,
    };
  }

  return {
    sourceLocator,
    eventType: payloadType ?? recordType,
    observedAt,
    metadata: {
      action: payloadType ?? recordType,
      recordType,
    },
    rawPayload: null,
  };
}

function tokenCountMetadata(value: unknown) {
  const info = asRecord(value);
  const totalUsage = asRecord(info.total_token_usage);

  return pruneUndefined({
    action: "reported token count",
    inputTokens: numberValue(totalUsage.input_tokens),
    cachedInputTokens: numberValue(totalUsage.cached_input_tokens),
    outputTokens: numberValue(totalUsage.output_tokens),
    reasoningOutputTokens: numberValue(totalUsage.reasoning_output_tokens),
    totalTokens: numberValue(totalUsage.total_tokens),
    modelContextWindow: numberValue(info.model_context_window),
    tokenQuality: "reported",
  });
}

function messageResponseItemEvent({
  payload,
  observedAt,
  sourceLocator,
}: {
  payload: Record<string, unknown>;
  observedAt: Date;
  sourceLocator: string;
}): ParsedCodexEvent {
  const role = stringValue(payload.role) ?? "unknown";
  const contentText = extractContentText(payload.content);
  const eventType =
    role === "assistant"
      ? "assistant_message"
      : role === "user"
        ? "user_message"
        : `${role}_message`;

  return {
    sourceLocator,
    eventType,
    observedAt,
    metadata: pruneUndefined({
      action:
        role === "assistant"
          ? "sent assistant message"
          : role === "user"
            ? "received user message"
            : `received ${role} message`,
      contentParts: contentText.parts,
    }),
    rawPayload: contentText.text,
    rawPayloadKind: "source_text",
  };
}

function extractContentText(value: unknown) {
  if (!Array.isArray(value)) {
    return {
      text: null,
      parts: 0,
    };
  }

  const parts = value
    .map((item) => asRecord(item).text)
    .filter((text): text is string => typeof text === "string");

  return {
    text: parts.length > 0 ? parts.join("\n") : null,
    parts: parts.length,
  };
}

async function readCodexSourceVersion(
  sourcePath: string,
): Promise<string | null> {
  try {
    const parsed = JSON.parse(
      await readFile(join(sourcePath, "version.json"), "utf8"),
    ) as unknown;
    const version = asRecord(parsed).latest_version;

    return typeof version === "string" && version.length > 0
      ? version
      : null;
  } catch {
    return null;
  }
}

function enrichMetadata(
  metadata: Record<string, unknown>,
  thread: CodexThreadRow,
) {
  if (metadata.action !== "started session") {
    return pruneUndefined(metadata);
  }

  return pruneUndefined({
    ...metadata,
    model: thread.model,
    gitBranch: thread.git_branch,
    gitSha: thread.git_sha,
    gitOriginUrl: thread.git_origin_url,
  });
}

function parseRolloutRecord(line: string): CodexRolloutRecord | null {
  try {
    const parsed = JSON.parse(line) as unknown;

    return asRecord(parsed) as CodexRolloutRecord;
  } catch {
    return null;
  }
}

function parseFunctionArguments(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") {
    return {};
  }

  try {
    return asRecord(JSON.parse(value));
  } catch {
    return {};
  }
}

function normalizeSource(source: SourceConfig): Required<SourceConfig> {
  return {
    sourceKey: source.sourceKey ?? `${source.sourceType}:${source.path}`,
    sourceType: source.sourceType,
    path: source.path,
  };
}

function absoluteRolloutPath(sourcePath: string, thread: CodexThreadRow) {
  return thread.rollout_path.startsWith("/")
    ? thread.rollout_path
    : join(sourcePath, thread.rollout_path);
}

function earliestDate(dates: Array<Date | null>, fallback: Date | null): Date {
  const timestamps = dates
    .filter((date): date is Date => date instanceof Date)
    .map((date) => date.getTime());

  return new Date(Math.min(...timestamps, fallback?.getTime() ?? Infinity));
}

function latestDate(dates: Array<Date | null>, fallback: Date | null): Date {
  const timestamps = dates
    .filter((date): date is Date => date instanceof Date)
    .map((date) => date.getTime());

  return new Date(Math.max(...timestamps, fallback?.getTime() ?? 0));
}

function dateFromMs(value: number | null): Date | null {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value)
    : null;
}

function dateFromUnknown(value: unknown): Date | null {
  if (typeof value !== "string") {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function pruneUndefined(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter((entry) => entry[1] !== undefined),
  );
}
