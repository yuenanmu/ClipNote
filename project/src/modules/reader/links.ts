import type { ReaderArchive, ReaderContent, ReaderLink } from '../../contracts/reader.ts';
export function externalUrl(url: string): string | undefined {
  if (url.length > 2048 || /[\u0000-\u0020\u007f]/.test(url) || !/^https?:\/\//i.test(url)) return;
  try { const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return; return parsed.href; } catch { return; }
}
export function classifyLink(url: string, content: ReaderContent, archive?: ReaderArchive): ReaderLink {
  if (url.startsWith('#')) {
    try {
      const id = decodeURIComponent(url.slice(1)), pending = [...content.headings];
      while (pending.length) { const heading = pending.pop()!; if (heading.id === id) return { kind: 'anchor', id }; pending.push(...heading.children); }
    } catch { /* Invalid percent encoding is a blocked link. */ }
    return { kind: 'blocked' };
  }
  const external = externalUrl(url);
  if (external) return { kind: 'external', url: external };
  if (archive) {
    try {
      const decoded = decodeURIComponent(url);
      if (decoded === archive.sourceFile) return { kind: 'source' };
      const segmentId = decoded.startsWith('clipnote-source:') ? decoded.slice('clipnote-source:'.length) : decoded.startsWith(archive.sourceFile + '#') ? decoded.slice(archive.sourceFile.length + 1) : undefined;
      if (segmentId && archive.segmentIds.includes(segmentId)) return { kind: 'source', segmentId };
    } catch { /* Unknown paths never gain file access. */ }
  }
  return { kind: 'blocked' };
}
