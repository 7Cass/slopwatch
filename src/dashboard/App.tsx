import { AlertTriangle, CircleCheck, CircleDot, OctagonX } from "lucide-react";
import { useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";

import { Badge, type BadgeProps } from "./components/ui/badge";
import { Card, CardContent, CardHeader } from "./components/ui/card";
import { connectToNowEvents } from "./now-stream";
import type { NowGroupKey, TokenQuality } from "../now/projection";
import type { WorkUnitState } from "../infer/work-unit";

export type SerializedNowAgentCard = {
  workUnitId: string;
  project: {
    displayName: string;
    rootPath: string;
  };
  state: WorkUnitState;
  activeTimeMs: number;
  lastActivityAt: string;
  lastAction?: string;
  toolCalls?: number;
  tokenQuality: TokenQuality;
};

export type SerializedNowProjectionGroup = {
  key: NowGroupKey;
  agents: SerializedNowAgentCard[];
};

export type SerializedNowProjection = {
  generatedAt: string;
  groups: SerializedNowProjectionGroup[];
};

const groupLabels: Record<NowGroupKey, string> = {
  blocked: "Blocked",
  active: "Active",
  failed: "Failed",
  recently_finished: "Recently finished",
};

const groupDescriptions: Record<NowGroupKey, string> = {
  blocked: "Waiting for outside action",
  active: "Recent work in motion",
  failed: "Needs attention",
  recently_finished: "Completed in the recent window",
};

const stateTone: Record<
  NowGroupKey,
  {
    badge: BadgeProps["variant"];
    icon: typeof AlertTriangle;
  }
> = {
  blocked: {
    badge: "warning",
    icon: AlertTriangle,
  },
  active: {
    badge: "default",
    icon: CircleDot,
  },
  failed: {
    badge: "danger",
    icon: OctagonX,
  },
  recently_finished: {
    badge: "success",
    icon: CircleCheck,
  },
};

export function DashboardRoutes({
  initialProjection,
}: {
  initialProjection?: SerializedNowProjection;
}) {
  return (
    <Routes>
      <Route path="/" element={<NowScreen projection={initialProjection} />} />
      <Route path="*" element={<NowScreen projection={initialProjection} />} />
    </Routes>
  );
}

function NowScreen({
  projection,
}: {
  projection?: SerializedNowProjection;
}) {
  const [nowProjection, setNowProjection] = useState(projection);
  const groups = nowProjection?.groups ?? [];

  useEffect(() => connectToNowEvents({ onProjection: setNowProjection }), []);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-2 border-b border-slate-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">Slopwatch</p>
            <h1 className="text-2xl font-semibold tracking-normal text-slate-950">
              Now
            </h1>
          </div>
          <p className="text-sm text-slate-500">
            Updated {formatTimestamp(nowProjection?.generatedAt)}
          </p>
        </header>

        {groups.length === 0 ? (
          <EmptyNowState />
        ) : (
          <div className="grid gap-4 xl:grid-cols-4">
            {groups.map((group) => (
              <AgentGroup key={group.key} group={group} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function AgentGroup({ group }: { group: SerializedNowProjectionGroup }) {
  const tone = stateTone[group.key];
  const Icon = tone.icon;

  return (
    <section className="min-w-0 space-y-3" aria-labelledby={`${group.key}-title`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id={`${group.key}-title`}
            className="flex items-center gap-2 text-base font-semibold text-slate-950"
          >
            <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span>{groupLabels[group.key]}</span>
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {groupDescriptions[group.key]}
          </p>
        </div>
        <Badge variant="muted">{group.agents.length}</Badge>
      </div>

      {group.agents.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-white/60 px-3 py-6 text-center text-sm text-slate-500">
          No agents
        </div>
      ) : (
        <div className="space-y-3">
          {group.agents.map((agent) => (
            <AgentCard key={agent.workUnitId} agent={agent} groupKey={group.key} />
          ))}
        </div>
      )}
    </section>
  );
}

function AgentCard({
  agent,
  groupKey,
}: {
  agent: SerializedNowAgentCard;
  groupKey: NowGroupKey;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-slate-950">
              {agent.project.displayName}
            </h3>
            <p className="mt-1 line-clamp-2 text-sm text-slate-600">
              {agent.lastAction ?? "No recent action"}
            </p>
          </div>
          <Badge variant={stateTone[groupKey].badge}>{groupLabels[groupKey]}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs text-slate-500">
          <Metric label="Last activity" value={formatRelative(agent.lastActivityAt)} />
          <Metric label="Active time" value={`${formatDuration(agent.activeTimeMs)} active`} />
          <Metric label="Tool calls" value={formatToolCalls(agent.toolCalls)} />
          <Metric label="Tokens" value={formatTokenQuality(agent.tokenQuality)} />
        </dl>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate">{label}</dt>
      <dd className="mt-0.5 truncate font-medium text-slate-800">{value}</dd>
    </div>
  );
}

function EmptyNowState() {
  return (
    <div className="rounded-lg border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
      <p className="text-sm font-medium text-slate-700">No Now snapshot yet</p>
    </div>
  );
}

function formatTimestamp(value?: string) {
  if (!value) {
    return "waiting for snapshot";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatRelative(value: string) {
  const timestamp = new Date(value).getTime();
  const elapsedMs = Math.max(0, Date.now() - timestamp);
  const minutes = Math.max(1, Math.round(elapsedMs / 60_000));

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.round(minutes / 60);

  return `${hours}h ago`;
}

function formatDuration(milliseconds: number) {
  const minutes = Math.round(milliseconds / 60_000);

  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (remainingMinutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${remainingMinutes}m`;
}

function formatToolCalls(toolCalls?: number) {
  if (toolCalls === undefined) {
    return "not tracked";
  }

  return `${toolCalls} ${toolCalls === 1 ? "tool call" : "tool calls"}`;
}

function formatTokenQuality(tokenQuality: TokenQuality) {
  if (tokenQuality === "unavailable") {
    return "not tracked";
  }

  return `${tokenQuality} tokens`;
}
