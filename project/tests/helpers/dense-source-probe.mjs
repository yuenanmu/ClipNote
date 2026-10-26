import { parseSource } from '../../src/modules/source/parser.ts';
const format = process.argv[2];
const raw = (format === 'srt' ? '1\n00:00:01,000 --> 00:00:02,000\n' : '') + 'a\n'.repeat(8_000_000);
const document = parseSource(Buffer.from(raw), `dense.${format}`);
console.log(JSON.stringify({ segments: document.segments.length, endLine: document.segments.at(-1).range.endLine, rss: process.memoryUsage().rss }));
