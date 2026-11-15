export function collectEmbeddedPackages(options: {
  projectRoot: string;
  files: Array<{path: string; group: 'main' | 'renderer'}>;
}): Promise<Array<{name: string; version: string; path: string; groups: Array<'main' | 'renderer'>}>>;
