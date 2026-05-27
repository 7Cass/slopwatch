import {
  listSources,
  type ListSourcesInput,
  type SourceReport,
} from "../admin/sources";

export type SourcesHealth = {
  generatedAt: Date;
  sources: SourceReport[];
};

export type SourcesHealthProvider = () => Promise<SourcesHealth>;

export type SourcesHealthProviderInput = ListSourcesInput & {
  now?: () => Date;
  sourceList?: typeof listSources;
};

export function createSourcesHealthProvider({
  config = {},
  env = {},
  detectors,
  healthChecker,
  now = () => new Date(),
  sourceList = listSources,
}: SourcesHealthProviderInput = {}): SourcesHealthProvider {
  return async () => ({
    generatedAt: now(),
    sources: await sourceList({
      config,
      env,
      detectors,
      healthChecker,
    }),
  });
}
