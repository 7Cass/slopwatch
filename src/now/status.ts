import type {
  NowProjection,
  NowProjectionGroup,
  NowProjectionProvider,
} from "./projection";

export type NowStatusOptions = {
  nowProvider: NowProjectionProvider;
  writeLine?: (line: string) => void;
};

export async function runNowStatus({
  nowProvider,
  writeLine = console.log,
}: NowStatusOptions) {
  const projection = await nowProvider();
  writeLine(formatNowStatus(projection));
}

export function formatNowStatus(projection: NowProjection) {
  const sections = projection.groups
    .map(formatGroup)
    .filter((section) => section.length > 0);

  if (sections.length === 0) {
    return "No current Agents.";
  }

  return sections.join("\n\n");
}

function formatGroup(group: NowProjectionGroup) {
  if (group.agents.length === 0) {
    return "";
  }

  return [
    formatGroupTitle(group.key),
    ...group.agents.map(
      (agent) =>
        `- ${agent.project.displayName} | ${agent.state} | ${agent.lastAction ?? "no recent action"} | ${agent.lastActivityAt.toISOString()} | active ${formatDuration(agent.activeTimeMs)} | tools ${agent.toolCalls ?? 0} | tokens ${agent.tokenQuality}`,
    ),
  ].join("\n");
}

function formatGroupTitle(key: NowProjectionGroup["key"]) {
  switch (key) {
    case "blocked":
      return "Blocked";
    case "active":
      return "Active";
    case "failed":
      return "Failed";
    case "recently_finished":
      return "Recently finished";
  }
}

function formatDuration(durationMs: number) {
  if (durationMs < 1000) {
    return "0s";
  }

  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  if (seconds === 0) {
    return `${minutes}m`;
  }

  return `${minutes}m ${seconds}s`;
}
