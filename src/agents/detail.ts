import type { WorkUnitState } from "../infer/work-unit";

export type AgentDetailEventRecord = {
  id: string;
  eventType: string;
  observedAt: Date;
  source: {
    sourceKey: string;
    sourceType: string;
    sourceLocator: string;
    path?: string | null;
  };
  metadata: Record<string, unknown>;
  rawPayload?: string | null;
};

export type AgentDetailRecord = {
  workUnitId: string;
  project: {
    displayName: string;
    rootPath: string;
  };
  state: WorkUnitState;
  activeTimeMs: number;
  lastActivityAt: Date;
  inference: {
    confidence: number;
    explanation: string;
    inferenceVersion: string;
    calculatedAt: Date;
  };
  forkOrigin?: {
    sourceForkId: string;
    originForkId?: string | null;
  };
  events: AgentDetailEventRecord[];
};

export type AgentDetailEvent = {
  id: string;
  eventType: string;
  observedAt: Date | string;
  action?: string;
  command?: string;
  filesTouched: string[];
  error?: string;
  source: {
    sourceKey: string;
    sourceType: string;
    sourceLocator: string;
    path?: string | null;
  };
  metadata: Record<string, unknown>;
  rawPayload?: string | null;
};

export type AgentDetail = {
  workUnitId: string;
  project: {
    displayName: string;
    rootPath: string;
  };
  state: WorkUnitState;
  activeTimeMs: number;
  lastActivityAt: Date | string;
  inference: {
    confidence: number;
    explanation: string;
    inferenceVersion: string;
    calculatedAt: Date | string;
  };
  forkOrigin?: {
    sourceForkId: string;
    originForkId?: string | null;
  };
  events: AgentDetailEvent[];
};

export type AgentDetailProvider = (
  workUnitId: string,
) => Promise<AgentDetail | null>;

export type AgentDetailStore = {
  getAgentDetailRecord: (workUnitId: string) => Promise<AgentDetailRecord | null>;
};

export type CloseableAgentDetailStore = AgentDetailStore & {
  close?: () => Promise<void>;
};

export type AgentDetailStoreFactory = (
  databaseUrl: string,
) => CloseableAgentDetailStore;

export async function getAgentDetail({
  store,
  workUnitId,
}: {
  store: AgentDetailStore;
  workUnitId: string;
}) {
  const record = await store.getAgentDetailRecord(workUnitId);

  return record ? buildAgentDetail(record) : null;
}

export function createAgentDetailProvider({
  databaseUrl,
  storeFactory,
}: {
  databaseUrl: string;
  storeFactory: AgentDetailStoreFactory;
}): AgentDetailProvider {
  return async (workUnitId) => {
    const store = storeFactory(databaseUrl);

    try {
      return await getAgentDetail({ store, workUnitId });
    } finally {
      await store.close?.();
    }
  };
}

export function buildAgentDetail(record: AgentDetailRecord): AgentDetail {
  return {
    workUnitId: record.workUnitId,
    project: record.project,
    state: record.state,
    activeTimeMs: record.activeTimeMs,
    lastActivityAt: record.lastActivityAt,
    inference: record.inference,
    forkOrigin: record.forkOrigin,
    events: [...record.events]
      .sort(
        (left, right) =>
          left.observedAt.getTime() - right.observedAt.getTime(),
      )
      .map(toAgentDetailEvent),
  };
}

function toAgentDetailEvent(record: AgentDetailEventRecord): AgentDetailEvent {
  return {
    id: record.id,
    eventType: record.eventType,
    observedAt: record.observedAt,
    action: readString(record.metadata.action) ?? record.eventType,
    command: readString(record.metadata.command),
    filesTouched: readFilesTouched(record.metadata),
    error: readError(record),
    source: record.source,
    metadata: record.metadata,
    rawPayload: record.rawPayload ?? null,
  };
}

function readFilesTouched(metadata: Record<string, unknown>) {
  const files = new Set<string>();

  for (const value of [
    metadata.filePath,
    metadata.file,
    metadata.filesTouched,
    metadata.filePaths,
    metadata.files,
  ]) {
    if (typeof value === "string") {
      files.add(value);
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") {
          files.add(item);
        }
      }
    }
  }

  return [...files];
}

function readError(record: AgentDetailEventRecord) {
  const message =
    readString(record.metadata.error) ?? readString(record.metadata.message);

  if (
    message &&
    (record.eventType === "error" ||
      record.metadata.status === "failed" ||
      isFailedExitCode(record.metadata.exitCode))
  ) {
    return message;
  }

  if (isFailedExitCode(record.metadata.exitCode)) {
    return `exit code ${record.metadata.exitCode}`;
  }

  if (record.metadata.status === "failed") {
    return "failed";
  }

  if (record.eventType === "error") {
    return message ?? "error";
  }

  return undefined;
}

function isFailedExitCode(value: unknown) {
  return typeof value === "number" && value !== 0;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}
