export type RuntimeEnv = {
  DATABASE_URL?: string;
  [key: string]: string | undefined;
};

export type RuntimeConfigFlags = {
  databaseUrl?: string;
};

export type RuntimeConfigInput = {
  env?: RuntimeEnv;
  flags?: RuntimeConfigFlags;
};

export type RuntimeConfig = {
  databaseUrl?: string;
};

export function resolveRuntimeConfig(
  input: RuntimeConfigInput = {},
): RuntimeConfig {
  return {
    databaseUrl: input.flags?.databaseUrl ?? input.env?.DATABASE_URL,
  };
}
