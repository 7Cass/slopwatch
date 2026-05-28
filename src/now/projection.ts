import type { WorkUnitState } from "../infer/work-unit";

export type NowGroupKey =
  | "blocked"
  | "active"
  | "failed"
  | "recently_finished";

export type TokenQuality = "real" | "reported" | "estimated" | "unavailable";

export type NowForkOriginPresentation = {
  originWorkUnitId: string;
  originProject: {
    displayName: string;
    rootPath: string;
  };
};

export type NowProjectionSourceRecord = {
  workUnitId: string;
  project: {
    displayName: string;
    rootPath: string;
  };
  state: WorkUnitState;
  confidence: number;
  explanation: string;
  activeTimeMs: number;
  lastActivityAt: Date;
  lastAction?: string;
  toolCalls?: number;
  tokenQuality?: TokenQuality;
  forkOrigin?: NowForkOriginPresentation;
};

export type NowAgentCard = {
  workUnitId: string;
  project: {
    displayName: string;
    rootPath: string;
  };
  state: WorkUnitState;
  activeTimeMs: number;
  lastActivityAt: Date;
  lastAction?: string;
  toolCalls?: number;
  tokenQuality: TokenQuality;
  forkOrigin?: NowForkOriginPresentation;
};

export type NowProjectionGroup = {
  key: NowGroupKey;
  agents: NowAgentCard[];
};

export type NowProjection = {
  generatedAt: Date;
  groups: NowProjectionGroup[];
};

export type NowProjectionStore = {
  listNowProjectionRecords: () => Promise<NowProjectionSourceRecord[]>;
};

export type CloseableNowProjectionStore = NowProjectionStore & {
  close?: () => Promise<void>;
};

export type NowProjectionProvider = () => Promise<NowProjection>;

export type NowProjectionStoreFactory = (
  databaseUrl: string,
) => CloseableNowProjectionStore;

export const defaultRecentlyFinishedWindowMs = 30 * 60 * 1000;

const groupOrder: NowGroupKey[] = [
  "blocked",
  "active",
  "failed",
  "recently_finished",
];

export async function getNowProjection({
  store,
  now = new Date(),
  recentlyFinishedWindowMs = defaultRecentlyFinishedWindowMs,
}: {
  store: NowProjectionStore;
  now?: Date;
  recentlyFinishedWindowMs?: number;
}): Promise<NowProjection> {
  return buildNowProjection({
    now,
    recentlyFinishedWindowMs,
    records: await store.listNowProjectionRecords(),
  });
}

export function createNowProjectionProvider({
  databaseUrl,
  storeFactory,
  now = () => new Date(),
  recentlyFinishedWindowMs = defaultRecentlyFinishedWindowMs,
}: {
  databaseUrl: string;
  storeFactory: NowProjectionStoreFactory;
  now?: () => Date;
  recentlyFinishedWindowMs?: number;
}): NowProjectionProvider {
  return async () => {
    const store = storeFactory(databaseUrl);

    try {
      return await getNowProjection({
        store,
        now: now(),
        recentlyFinishedWindowMs,
      });
    } finally {
      await store.close?.();
    }
  };
}

export function buildNowProjection({
  now = new Date(),
  recentlyFinishedWindowMs = defaultRecentlyFinishedWindowMs,
  records,
}: {
  now?: Date;
  recentlyFinishedWindowMs?: number;
  records: NowProjectionSourceRecord[];
}): NowProjection {
  const groups = new Map<NowGroupKey, NowAgentCard[]>(
    groupOrder.map((key) => [key, []]),
  );

  for (const record of records) {
    if (
      record.state === "finished" &&
      !isRecentlyFinished({
        now,
        lastActivityAt: record.lastActivityAt,
        recentlyFinishedWindowMs,
      })
    ) {
      continue;
    }

    const groupKey = toGroupKey(record.state);
    const agents = groups.get(groupKey);

    if (!agents) {
      continue;
    }

    agents.push(toAgentCard(record));
  }

  return {
    generatedAt: now,
    groups: groupOrder.map((key) => ({
      key,
      agents: [...(groups.get(key) ?? [])].sort(compareAgentsByActivity),
    })),
  };
}

function toGroupKey(state: WorkUnitState): NowGroupKey {
  if (state === "finished") {
    return "recently_finished";
  }

  return state;
}

function toAgentCard(record: NowProjectionSourceRecord): NowAgentCard {
  return {
    workUnitId: record.workUnitId,
    project: record.project,
    state: record.state,
    activeTimeMs: record.activeTimeMs,
    lastActivityAt: record.lastActivityAt,
    lastAction: record.lastAction,
    toolCalls: record.toolCalls,
    tokenQuality: record.tokenQuality ?? "unavailable",
    forkOrigin: record.forkOrigin,
  };
}

function compareAgentsByActivity(left: NowAgentCard, right: NowAgentCard) {
  return right.lastActivityAt.getTime() - left.lastActivityAt.getTime();
}

function isRecentlyFinished({
  now,
  lastActivityAt,
  recentlyFinishedWindowMs,
}: {
  now: Date;
  lastActivityAt: Date;
  recentlyFinishedWindowMs: number;
}) {
  return now.getTime() - lastActivityAt.getTime() <= recentlyFinishedWindowMs;
}
