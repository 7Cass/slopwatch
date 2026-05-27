export type EventMetadata = Record<string, unknown>;
export type RawPayloadKind = "source_text" | "file_content";

export function applyEventDataPolicy(
  event: {
    metadata: EventMetadata;
    rawPayload?: string | null;
    rawPayloadKind?: RawPayloadKind;
  },
  options: { includeContent?: boolean } = {},
) {
  return {
    metadata: sanitizeMetadata(event.metadata),
    rawPayload:
      options.includeContent && event.rawPayloadKind !== "file_content"
        ? (event.rawPayload ?? null)
        : null,
  };
}

const contentMetadataKeys = new Set([
  "body",
  "content",
  "contents",
  "diff",
  "filebody",
  "filecontent",
  "filecontents",
  "fullsource",
  "fulltext",
  "patch",
  "prompt",
  "prompttext",
  "rawbody",
  "rawcontent",
  "rawfilecontent",
  "rawfilecontents",
  "rawpayload",
  "rawprompt",
  "rawresponse",
  "response",
  "responsetext",
  "transcript",
]);

const sensitiveMetadataKeys = new Set([
  "apikey",
  "authorization",
  "authtoken",
  "credential",
  "credentials",
  "password",
  "privatekey",
  "secret",
  "token",
]);

function sanitizeMetadata(metadata: EventMetadata): EventMetadata {
  return sanitizeObject(metadata) as EventMetadata;
}

function sanitizeValue(value: unknown, key?: string): unknown {
  if (typeof value === "string") {
    return key && isSensitiveMetadataKey(key)
      ? "[REDACTED]"
      : redactSecretShapedText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }

  if (isPlainObject(value)) {
    return sanitizeObject(value);
  }

  return value;
}

function sanitizeObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !contentMetadataKeys.has(normalizeMetadataKey(key)))
      .map(([key, entryValue]) => [key, sanitizeValue(entryValue, key)]),
  );
}

function redactSecretShapedText(value: string) {
  return value
    .replace(
      /(\b[A-Z0-9_]*(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|TOKEN|SECRET|PASSWORD|PRIVATE_KEY)[A-Z0-9_]*\s*=\s*)(["']?)[^\s"'`]+/gi,
      "$1$2[REDACTED]",
    )
    .replace(/(\bBearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]")
    .replace(
      /(\bAuthorization\s*:\s*Bearer\s+)[A-Za-z0-9._~+/=-]+/gi,
      "$1[REDACTED]",
    );
}

function isSensitiveMetadataKey(key: string) {
  return sensitiveMetadataKeys.has(normalizeMetadataKey(key));
}

function normalizeMetadataKey(key: string) {
  return key.replace(/[-_\s]/g, "").toLowerCase();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}
