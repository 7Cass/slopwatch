export type CollectionWindow = {
  since: Date;
};

const relativeWindowPattern = /^(\d+)(m|h|d)$/i;
const unitMs = {
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

export function parseCollectionWindow(
  value: string | undefined,
  now: Date = new Date(),
): CollectionWindow | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  const relativeMatch = relativeWindowPattern.exec(trimmed);

  if (relativeMatch) {
    const amount = Number.parseInt(relativeMatch[1] ?? "", 10);
    const unit = (relativeMatch[2] ?? "").toLowerCase() as keyof typeof unitMs;

    if (amount > 0) {
      return {
        since: new Date(now.getTime() - amount * unitMs[unit]),
      };
    }
  }

  const timestamp = new Date(trimmed);

  if (!Number.isNaN(timestamp.getTime())) {
    return {
      since: timestamp,
    };
  }

  throw new Error(
    "Invalid --since value. Use an ISO timestamp or a window like 30m, 2h, or 7d.",
  );
}

export function formatCollectionWindow(
  collectionWindow: CollectionWindow | undefined,
) {
  return collectionWindow
    ? ` since ${collectionWindow.since.toISOString()}`
    : "";
}

export function isInsideCollectionWindow(
  observedAt: Date,
  collectionWindow: CollectionWindow | undefined,
) {
  if (!collectionWindow) {
    return true;
  }

  return observedAt >= collectionWindow.since;
}
