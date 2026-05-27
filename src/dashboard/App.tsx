import {
  AlertTriangle,
  ArrowLeft,
  CircleCheck,
  CircleDot,
  OctagonX,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import {
  Link,
  Route,
  Routes,
  useParams,
  useSearchParams,
} from "react-router-dom";

import { Badge, type BadgeProps } from "./components/ui/badge";
import { Card, CardContent, CardHeader } from "./components/ui/card";
import { connectToNowEvents } from "./now-stream";
import type { SourceHealthStatus, SourceReport } from "../admin/sources";
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

export type SerializedProjectOverview = {
  projectKey: string;
  project: {
    displayName: string;
    rootPath: string;
  };
  lastActivityAt: string;
  agentCounts: {
    total: number;
    active: number;
    blocked: number;
    failed: number;
    finished: number;
  };
};

export type SerializedProjectsOverview = {
  generatedAt: string;
  projects: SerializedProjectOverview[];
};

export type SerializedSourceHealth = SourceReport;

export type SerializedSourcesHealth = {
  generatedAt: string;
  sources: SerializedSourceHealth[];
};

export type SerializedAgentDetailEvent = {
  id: string;
  eventType: string;
  observedAt: string;
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

export type SerializedAgentDetail = {
  workUnitId: string;
  project: {
    displayName: string;
    rootPath: string;
  };
  state: WorkUnitState;
  activeTimeMs: number;
  lastActivityAt: string;
  inference: {
    confidence: number;
    explanation: string;
    inferenceVersion: string;
    calculatedAt: string;
  };
  forkOrigin?: {
    sourceForkId: string;
    originForkId?: string | null;
  };
  events: SerializedAgentDetailEvent[];
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

const workUnitStateLabels: Record<WorkUnitState, string> = {
  active: "Active",
  blocked: "Blocked",
  failed: "Failed",
  finished: "Finished",
};

const workUnitStateBadges: Record<WorkUnitState, BadgeProps["variant"]> = {
  active: "default",
  blocked: "warning",
  failed: "danger",
  finished: "success",
};

const sourceHealthBadges: Record<SourceHealthStatus, BadgeProps["variant"]> = {
  ok: "success",
  missing: "warning",
  unreadable: "danger",
  malformed: "warning",
};

export function DashboardRoutes({
  initialProjection,
  initialProjects,
  initialSources,
  initialAgentDetails = [],
}: {
  initialProjection?: SerializedNowProjection;
  initialProjects?: SerializedProjectsOverview;
  initialSources?: SerializedSourcesHealth;
  initialAgentDetails?: SerializedAgentDetail[];
}) {
  return (
    <Routes>
      <Route path="/" element={<NowScreen projection={initialProjection} />} />
      <Route
        path="/projects"
        element={<ProjectsScreen overview={initialProjects} />}
      />
      <Route
        path="/sources"
        element={<SourcesScreen health={initialSources} />}
      />
      <Route
        path="/agents/:workUnitId"
        element={<AgentDetailScreen initialAgentDetails={initialAgentDetails} />}
      />
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
  const [searchParams] = useSearchParams();
  const selectedProject = searchParams.get("project");
  const groups = selectedProject
    ? (nowProjection?.groups ?? []).map((group) => ({
        ...group,
        agents: group.agents.filter(
          (agent) => agent.project.rootPath === selectedProject,
        ),
      }))
    : (nowProjection?.groups ?? []);

  useEffect(() => connectToNowEvents({ onProjection: setNowProjection }), []);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <DashboardTitle title="Now" />
          <p className="text-sm text-slate-500">
            Updated {formatTimestamp(nowProjection?.generatedAt)}
          </p>
        </header>

        {selectedProject ? (
          <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-600">
            Showing Agent activity for{" "}
            <span className="font-medium text-slate-900">{selectedProject}</span>
          </div>
        ) : null}

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

function ProjectsScreen({
  overview,
}: {
  overview?: SerializedProjectsOverview;
}) {
  const [projectsOverview, setProjectsOverview] = useState(overview);
  const [status, setStatus] = useState<"loading" | "loaded" | "unavailable">(
    overview ? "loaded" : "loading",
  );
  const projects = projectsOverview?.projects ?? [];

  useEffect(() => {
    if (projectsOverview) {
      return;
    }

    let cancelled = false;

    setStatus("loading");

    fetch("/api/projects/recent")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to load Projects: ${response.status}`);
        }

        return (await response.json()) as SerializedProjectsOverview;
      })
      .then((loadedOverview) => {
        if (!cancelled) {
          setProjectsOverview(loadedOverview);
          setStatus("loaded");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("unavailable");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectsOverview]);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <DashboardTitle title="Projects" />
          <p className="text-sm text-slate-500">
            Updated {formatTimestamp(projectsOverview?.generatedAt)}
          </p>
        </header>

        {projects.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
            <p className="text-sm font-medium text-slate-700">
              {formatEmptyProjectsState(status)}
            </p>
          </div>
        ) : (
          <div className="grid gap-3">
            {projects.map((project) => (
              <ProjectCard key={project.projectKey} project={project} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function SourcesScreen({
  health,
}: {
  health?: SerializedSourcesHealth;
}) {
  const [sourcesHealth, setSourcesHealth] = useState(health);
  const [status, setStatus] = useState<"loading" | "loaded" | "unavailable">(
    health ? "loaded" : "loading",
  );
  const sources = sourcesHealth?.sources ?? [];

  useEffect(() => {
    if (sourcesHealth) {
      return;
    }

    let cancelled = false;

    setStatus("loading");

    fetch("/api/sources/health")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to load Sources: ${response.status}`);
        }

        return (await response.json()) as SerializedSourcesHealth;
      })
      .then((loadedHealth) => {
        if (!cancelled) {
          setSourcesHealth(loadedHealth);
          setStatus("loaded");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("unavailable");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sourcesHealth]);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <DashboardTitle title="Sources" />
          <p className="text-sm text-slate-500">
            Updated {formatTimestamp(sourcesHealth?.generatedAt)}
          </p>
        </header>

        {sources.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
            <p className="text-sm font-medium text-slate-700">
              {formatEmptySourcesState(status)}
            </p>
          </div>
        ) : (
          <div className="grid gap-3">
            {sources.map((source) => (
              <SourceCard key={source.sourceKey} source={source} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function AgentDetailScreen({
  initialAgentDetails,
}: {
  initialAgentDetails: SerializedAgentDetail[];
}) {
  const { workUnitId: encodedWorkUnitId } = useParams();
  const workUnitId = encodedWorkUnitId
    ? decodeURIComponent(encodedWorkUnitId)
    : "";
  const [detail, setDetail] = useState<SerializedAgentDetail | undefined>(() =>
    initialAgentDetails.find((candidate) => candidate.workUnitId === workUnitId),
  );
  const [status, setStatus] = useState<"loading" | "loaded" | "missing">(
    detail ? "loaded" : "loading",
  );

  useEffect(() => {
    if (!workUnitId || detail?.workUnitId === workUnitId) {
      return;
    }

    let cancelled = false;

    setStatus("loading");

    fetch(`/api/agents/${encodeURIComponent(workUnitId)}`)
      .then(async (response) => {
        if (response.status === 404) {
          return null;
        }

        if (!response.ok) {
          throw new Error(`Failed to load Agent detail: ${response.status}`);
        }

        return (await response.json()) as SerializedAgentDetail;
      })
      .then((loadedDetail) => {
        if (cancelled) {
          return;
        }

        setDetail(loadedDetail ?? undefined);
        setStatus(loadedDetail ? "loaded" : "missing");
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("missing");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [detail?.workUnitId, workUnitId]);

  if (!detail) {
    return (
      <main className="min-h-screen bg-slate-50 text-slate-950">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
          <BackToNowLink />
          <div className="rounded-lg border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
            <p className="text-sm font-medium text-slate-700">
              {status === "loading" ? "Loading Agent detail" : "Agent not found"}
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <BackToNowLink />

        <header className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-500">Agent detail</p>
            <h1 className="truncate text-2xl font-semibold tracking-normal text-slate-950">
              {detail.project.displayName}
            </h1>
            <p className="mt-1 truncate text-sm text-slate-500">
              {detail.project.rootPath}
            </p>
          </div>
          <Badge variant={workUnitStateBadges[detail.state]}>
            {workUnitStateLabels[detail.state]}
          </Badge>
        </header>

        <dl className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-3">
          <Metric
            label="Last activity"
            value={formatTimestamp(detail.lastActivityAt)}
          />
          <Metric
            label="Active time"
            value={`${formatDuration(detail.activeTimeMs)} active`}
          />
          <Metric
            label="Inference"
            value={`${formatConfidence(detail.inference.confidence)} confidence`}
          />
        </dl>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-slate-950">Inference</h2>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-sm font-medium text-slate-900">
              {formatConfidence(detail.inference.confidence)} confidence
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {detail.inference.explanation}
            </p>
            <p className="mt-3 text-xs text-slate-500">
              {detail.inference.inferenceVersion} calculated{" "}
              {formatTimestamp(detail.inference.calculatedAt)}
            </p>
          </div>
        </section>

        {detail.forkOrigin ? <ForkOriginPanel fork={detail.forkOrigin} /> : null}

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-slate-950">Timeline</h2>
          <ol className="space-y-3">
            {detail.events.map((event) => (
              <AgentDetailTimelineItem key={event.id} event={event} />
            ))}
          </ol>
        </section>

        <RawPayloadPanel events={detail.events} />
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
    <Link
      to={`/agents/${encodeURIComponent(agent.workUnitId)}`}
      className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
    >
      <Card className="transition hover:border-slate-300 hover:shadow-md">
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
            <Badge variant={stateTone[groupKey].badge}>
              {groupLabels[groupKey]}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs text-slate-500">
            <Metric
              label="Last activity"
              value={formatRelative(agent.lastActivityAt)}
            />
            <Metric
              label="Active time"
              value={`${formatDuration(agent.activeTimeMs)} active`}
            />
            <Metric label="Tool calls" value={formatToolCalls(agent.toolCalls)} />
            <Metric
              label="Tokens"
              value={formatTokenQuality(agent.tokenQuality)}
            />
          </dl>
        </CardContent>
      </Card>
    </Link>
  );
}

function BackToNowLink() {
  return (
    <Link
      to="/"
      className="inline-flex w-fit items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-950"
    >
      <ArrowLeft aria-hidden="true" className="h-4 w-4" />
      Now
    </Link>
  );
}

function DashboardTitle({ title }: { title: string }) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-slate-500">Slopwatch</p>
        <h1 className="text-2xl font-semibold tracking-normal text-slate-950">
          {title}
        </h1>
      </div>
      <nav aria-label="Dashboard" className="flex flex-wrap gap-2">
        <DashboardNavLink to="/">Now</DashboardNavLink>
        <DashboardNavLink to="/projects">Projects</DashboardNavLink>
        <DashboardNavLink to="/sources">Sources</DashboardNavLink>
      </nav>
    </div>
  );
}

function DashboardNavLink({
  to,
  children,
}: {
  to: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:border-slate-300 hover:text-slate-950"
    >
      {children}
    </Link>
  );
}

function ProjectCard({ project }: { project: SerializedProjectOverview }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-slate-950">
              {project.project.displayName}
            </h2>
            <p className="mt-1 break-words text-sm text-slate-500">
              {project.project.rootPath}
            </p>
          </div>
          <Link
            to={`/?project=${encodeURIComponent(project.project.rootPath)}`}
            className="inline-flex w-fit items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            View Agents
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-3 text-sm text-slate-600 sm:grid-cols-5">
          <Metric
            label="Last activity"
            value={formatTimestamp(project.lastActivityAt)}
          />
          <Metric
            label="Agents"
            value={`${project.agentCounts.total} ${pluralize("Agent", project.agentCounts.total)}`}
          />
          <Metric
            label="Active"
            value={`${project.agentCounts.active} Active`}
          />
          <Metric
            label="Blocked"
            value={`${project.agentCounts.blocked} Blocked`}
          />
          <Metric
            label="Finished"
            value={`${project.agentCounts.finished} Finished`}
          />
        </dl>
      </CardContent>
    </Card>
  );
}

function SourceCard({ source }: { source: SerializedSourceHealth }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="break-words text-base font-semibold text-slate-950">
              {source.sourceKey}
            </h2>
            <p className="mt-1 break-words text-sm text-slate-500">
              {source.path}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="muted">{source.origin}</Badge>
            {source.overridden ? <Badge variant="warning">override</Badge> : null}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-3 text-sm text-slate-600 sm:grid-cols-3">
          <Metric label="Type" value={source.sourceType} />
          <SourceHealthMetric label="Health" health={source.health} />
          <SourceHealthMetric label="Format" health={source.format} />
        </dl>
      </CardContent>
    </Card>
  );
}

function SourceHealthMetric({
  label,
  health,
}: {
  label: string;
  health: SerializedSourceHealth["health"];
}) {
  return (
    <div className="min-w-0">
      <dt className="truncate">{label}</dt>
      <dd className="mt-1 space-y-1">
        <Badge variant={sourceHealthBadges[health.status]}>{health.status}</Badge>
        {health.message ? (
          <p className="break-words text-sm text-slate-600">{health.message}</p>
        ) : null}
      </dd>
    </div>
  );
}

function ForkOriginPanel({
  fork,
}: {
  fork: NonNullable<SerializedAgentDetail["forkOrigin"]>;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-base font-semibold text-slate-950">Fork origin</h2>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <Metric label="Fork" value={fork.sourceForkId} />
        <Metric
          label="Origin"
          value={fork.originForkId ?? "Origin not recorded"}
        />
      </dl>
    </section>
  );
}

function AgentDetailTimelineItem({
  event,
}: {
  event: SerializedAgentDetailEvent;
}) {
  const metadataEntries = Object.entries(event.metadata).filter(
    ([, value]) => value !== undefined && value !== null,
  );

  return (
    <li>
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-normal text-slate-500">
                {formatTimestamp(event.observedAt)}
              </p>
              <h3 className="mt-1 text-sm font-semibold text-slate-950">
                {event.action ?? event.eventType}
              </h3>
            </div>
            <Badge variant={event.eventType === "error" ? "danger" : "muted"}>
              {event.eventType}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 text-sm text-slate-600">
            {event.command ? (
              <DetailRow label="Command" value={<code>{event.command}</code>} />
            ) : null}
            {event.filesTouched.length > 0 ? (
              <DetailRow
                label="Files touched"
                value={event.filesTouched.join(", ")}
              />
            ) : null}
            {event.error ? <DetailRow label="Error" value={event.error} /> : null}
            <DetailRow
              label="Source"
              value={`${event.source.sourceKey} / ${event.source.sourceLocator}`}
            />
            {metadataEntries.length > 0 ? (
              <DetailRow
                label="Metadata"
                value={metadataEntries
                  .map(
                    ([key, value]) =>
                      `${formatMetadataKey(key)} ${formatMetadataValue(value)}`,
                  )
                  .join(", ")}
              />
            ) : null}
          </dl>
        </CardContent>
      </Card>
    </li>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-slate-800">{value}</dd>
    </div>
  );
}

function RawPayloadPanel({ events }: { events: SerializedAgentDetailEvent[] }) {
  const [showRawPayload, setShowRawPayload] = useState(false);
  const rawPayloadEvents = events.filter((event) => event.rawPayload);

  if (rawPayloadEvents.length === 0) {
    return null;
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-950">
            Raw payload
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Available for {rawPayloadEvents.length} Event
            {rawPayloadEvents.length === 1 ? "" : "s"}.
          </p>
        </div>
        <button
          type="button"
          aria-expanded={showRawPayload}
          onClick={() => setShowRawPayload((current) => !current)}
          className="inline-flex h-9 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {showRawPayload ? "Hide Raw payload" : "Show Raw payload"}
        </button>
      </div>

      {showRawPayload ? (
        <div className="mt-4 space-y-3">
          {rawPayloadEvents.map((event) => (
            <pre
              key={event.id}
              className="max-h-80 overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-50"
            >
              {event.rawPayload}
            </pre>
          ))}
        </div>
      ) : null}
    </section>
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

function formatEmptyProjectsState(
  status: "loading" | "loaded" | "unavailable",
) {
  if (status === "loading") {
    return "Loading Projects";
  }

  if (status === "unavailable") {
    return "Projects unavailable";
  }

  return "No recent Projects";
}

function formatEmptySourcesState(status: "loading" | "loaded" | "unavailable") {
  if (status === "loading") {
    return "Loading Sources";
  }

  if (status === "unavailable") {
    return "Sources unavailable";
  }

  return "No Sources detected";
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

function formatConfidence(confidence: number) {
  return `${Math.round(confidence * 100)}%`;
}

function formatMetadataKey(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase());
}

function formatMetadataValue(value: unknown) {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return JSON.stringify(value);
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

function pluralize(label: string, count: number) {
  return count === 1 ? label : `${label}s`;
}
