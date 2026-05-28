import type { TokenQuality } from "./projection";

export function readTokenQuality(value: unknown): TokenQuality | undefined {
  return value === "real" ||
    value === "reported" ||
    value === "estimated" ||
    value === "unavailable"
    ? value
    : undefined;
}

export function selectTokenQuality(values: Iterable<unknown>) {
  let selected: TokenQuality | undefined;
  let selectedPriority = 0;

  for (const value of values) {
    const tokenQuality = readTokenQuality(value);

    if (!tokenQuality) {
      continue;
    }

    const priority = tokenQualityPriority(tokenQuality);

    if (!selected || priority > selectedPriority) {
      selected = tokenQuality;
      selectedPriority = priority;
    }

    if (selectedPriority === 3) {
      break;
    }
  }

  return selected;
}

function tokenQualityPriority(tokenQuality: TokenQuality) {
  switch (tokenQuality) {
    case "real":
    case "reported":
      return 3;
    case "estimated":
      return 2;
    case "unavailable":
      return 1;
  }
}
