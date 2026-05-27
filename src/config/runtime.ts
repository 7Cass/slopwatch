export type RuntimeEnv = {
  DATABASE_URL?: string;
  [key: string]: string | undefined;
};

export type SourceConfig = {
  sourceKey?: string;
  sourceType: string;
  path: string;
};

export type RuntimeConfigFlags = {
  databaseUrl?: string;
  sources?: SourceConfig[];
};

export type RuntimeConfigInput = {
  defaults?: Partial<RuntimeConfig>;
  userConfig?: Partial<RuntimeConfig>;
  env?: RuntimeEnv;
  flags?: RuntimeConfigFlags;
};

export type RuntimeConfig = {
  databaseUrl?: string;
  sources?: SourceConfig[];
};

export function resolveRuntimeConfig(
  input: RuntimeConfigInput = {},
): RuntimeConfig {
  const defaults = input.defaults ?? {};
  const userConfig = input.userConfig ?? {};

  return {
    databaseUrl:
      input.flags?.databaseUrl ??
      input.env?.DATABASE_URL ??
      userConfig.databaseUrl ??
      defaults.databaseUrl,
    sources:
      input.flags?.sources ??
      userConfig.sources ??
      defaults.sources ??
      [],
  };
}
