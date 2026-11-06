export interface EmbeddedPackage {
  name: string;
  version: string;
  path: string;
  groups?: Array<'main' | 'renderer'>;
}

export interface NoticeDraft {
  name: string;
  version: string;
  declaredLicense: unknown;
  groups: Array<'main' | 'renderer'>;
  noticeSource: 'package' | 'supplemental';
  files: string[];
}

export function createNoticeDraft(options: {
  projectRoot: string;
  outputDir: string;
  packages: EmbeddedPackage[];
}): Promise<NoticeDraft[]>;
