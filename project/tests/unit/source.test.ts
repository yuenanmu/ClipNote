import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseSource, MAX_FILE_BYTES, MAX_SEGMENTS } from '../../src/modules/source/parser.ts';
import { importSourceFile } from '../../src/modules/source/import-file.ts';

const bytes = (text: string) => Buffer.from(text, 'utf8');
const parse = (text: string, ext = 'txt') => parseSource(bytes(text), `D:/合成 样例/来源.${ext}`);
const codeIs = (code: string) => (error: unknown) => (error as { code?: string }).code === code;

test('SRT preserves exact source, actual timestamps and text-line ranges', () => {
  const raw = '1\r\n00:00:01,250 --> 00:00:03,500\r\n你好\r\n第二行\r\n\r\n2\r\n00:00:04,000 --> 00:00:05,000\r\n结尾\r\n';
  const result = parse(raw, 'srt');
  assert.equal(result.rawText, raw);
  assert.equal(result.fileName, '来源.srt');
  assert.equal(result.segments.length, 2);
  assert.equal(result.segments[0].startMs, 1250);
  assert.equal(result.segments[0].endMs, 3500);
  assert.equal(result.segments[0].text, '你好\r\n第二行');
  assert.equal(result.segments[0].range.startLine, 3);
  assert.equal(result.segments[0].range.endLine, 4);
  assert.equal(raw.slice(result.segments[0].range.startOffset, result.segments[0].range.endOffset), result.segments[0].text);
});

test('VTT handles identifiers, cue settings, header metadata and comment blocks', () => {
  const result = parse('WEBVTT\nLanguage: zh\n\nNOTE 合成注释\n不是字幕\n\ncue-a\n00:01.500 --> 00:03.000 align:start\n第一段\n\nSTYLE\n::cue { color: red }\n\n00:00:04.000 --> 00:00:05.000\n第二段', 'vtt');
  assert.equal(result.segments.length, 2);
  assert.equal(result.segments[0].startMs, 1500);
  assert.equal(result.segments[1].startMs, 4000);
  assert.equal(result.segments[0].text, '第一段');
});

test('TXT and MD preserve paragraphs and source references without invented times', () => {
  for (const ext of ['txt', 'md']) {
    const result = parse('# 标题\r第一段\r\r下一段', ext);
    assert.deepEqual(result.segments.map(segment => segment.text), ['# 标题\r第一段', '下一段']);
    assert.deepEqual(result.segments.map(segment => [segment.range.startLine, segment.range.endLine]), [[1, 2], [4, 4]]);
    assert.equal(result.segments[0].startMs, undefined);
    assert.equal(result.segments[0].endMs, undefined);
  }
});

test('source and segment identities are stable across repeated imports and paths', () => {
  const first = parse('甲\n\n乙');
  const second = parseSource(bytes('甲\n\n乙'), 'D:/另一个位置/另一名字.txt');
  assert.equal(first.sourceId, second.sourceId);
  assert.deepEqual(first.segments.map(segment => segment.segmentId), second.segments.map(segment => segment.segmentId));
  assert.notEqual(first.sourceId, parse('不同内容').sourceId);
  assert.match(first.checksum, /^[a-f0-9]{64}$/);
});

test('UTF-8 BOM and UTF-16 little/big endian decode Chinese without replacement', () => {
  const utf8 = parseSource(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes('你好')]), '样例.txt');
  const le = Buffer.from('你好\r\n下一行', 'utf16le');
  const be = Buffer.from(le); be.swap16();
  const little = parseSource(Buffer.concat([Buffer.from([0xff, 0xfe]), le]), '样例.txt');
  const big = parseSource(Buffer.concat([Buffer.from([0xfe, 0xff]), be]), '样例.txt');
  assert.equal(utf8.rawText, '你好');
  assert.equal(little.rawText, '你好\r\n下一行');
  assert.equal(big.rawText, little.rawText);
  assert.equal(little.encoding, 'utf-16le');
  assert.equal(big.encoding, 'utf-16be');
});

test('GB18030-compatible Chinese files are decoded and the encoding is reported', () => {
  const result = parseSource(Buffer.from([0xc4, 0xe3, 0xba, 0xc3]), '中文.txt');
  assert.equal(result.rawText, '你好');
  assert.equal(result.encoding, 'gb18030');
});

test('empty or whitespace-only sources fail explicitly', () => {
  for (const text of ['', ' \r\n\t']) assert.throws(() => parse(text), codeIs('EMPTY_FILE'));
});

test('unsupported formats and binary or truncated encoded data fail explicitly', () => {
  assert.throws(() => parse('内容', 'pdf'), codeIs('UNSUPPORTED_FORMAT'));
  assert.throws(() => parseSource(Buffer.from([0x61, 0, 0x62]), 'binary.txt'), codeIs('INVALID_ENCODING'));
  assert.throws(() => parseSource(Buffer.from([0xff, 0xfe, 0x61]), 'broken.txt'), codeIs('INVALID_ENCODING'));
});

test('invalid timestamps, reverse ranges, missing text and mixed damage are rejected', () => {
  const invalid = [
    '1\n00:61:00,000 --> 00:62:00,000\n内容',
    '1\n00:00:03,000 --> 00:00:01,000\n内容',
    '1\n00:00:01,000 --> 00:00:03,000',
    '1\n00:00:01,000 --> 00:00:02,000\n正常\n\n2\n损坏时间\n不能静默丢弃',
  ];
  for (const text of invalid) assert.throws(() => parse(text, 'srt'), codeIs('INVALID_SUBTITLE'));
  assert.throws(() => parse('00:01.000 --> 00:02.000\n缺少头部', 'vtt'), codeIs('INVALID_SUBTITLE'));
});

test('long single paragraphs stay complete and resource limits are explicit', () => {
  const text = '长'.repeat(200_000);
  assert.equal(parse(text).segments[0].text, text);
  assert.throws(() => parseSource(new Uint8Array(MAX_FILE_BYTES + 1), 'large.txt'), codeIs('FILE_TOO_LARGE'));
  assert.throws(() => parse(Array.from({ length: MAX_SEGMENTS + 1 }, () => '段').join('\n\n')), codeIs('TOO_MANY_SEGMENTS'));
});

test('VTT header separation cannot silently swallow the first cue', () => {
  assert.throws(() => parse('WEBVTT\n00:01.000 --> 00:02.000\n不能遗漏\n\n00:03.000 --> 00:04.000\n第二段', 'vtt'), codeIs('INVALID_SUBTITLE'));
  assert.throws(() => parse('WEBVTT\ncue-a\n损坏的首段时间\n不能遗漏\n\n00:03.000 --> 00:04.000\n第二段', 'vtt'), codeIs('INVALID_SUBTITLE'));
});

test('subtitle cue boundaries cannot merge two actual timestamp ranges', () => {
  assert.throws(() => parse('1\n00:00:01,000 --> 00:00:02,000\n第一段\n2\n00:00:03,000 --> 00:00:04,000\n第二段', 'srt'), codeIs('INVALID_SUBTITLE'));
  assert.throws(() => parse('WEBVTT\n\n00:01.000 --> 00:02.000\n第一段\n00:03.000 --> 00:04.000\n第二段', 'vtt'), codeIs('INVALID_SUBTITLE'));
});

for (const format of ['txt', 'srt']) test(`dense short-line ${format} sources fit a 128 MiB JavaScript heap without losing lines`, () => {
  const helper = fileURLToPath(new URL('../helpers/dense-source-probe.mjs', import.meta.url));
  const result = spawnSync(process.execPath, ['--max-old-space-size=128', helper, format], { windowsHide: true, encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.error, undefined, 'Dense source parsing must finish within the bounded test time');
  assert.equal(result.status, 0, 'An allowed source must parse within the 128 MiB JS heap budget');
  const report = JSON.parse(result.stdout);
  assert.equal(report.segments, 1);
  assert.equal(report.endLine, format === 'srt' ? 8_000_002 : 8_000_000);
});

test('actual imports support Chinese and spaces, keep files intact and classify missing files', async t => {
  const base = fileURLToPath(new URL('../../../.local/test-artifacts/', import.meta.url));
  mkdirSync(base, { recursive: true });
  const own = mkdtempSync(join(base, 'source-'));
  t.after(() => { assert.equal(resolve(dirname(own)), resolve(base)); rmSync(own, { recursive: true, force: true }); });
  const file = join(own, '中文 空格.MD');
  writeFileSync(file, '# 合成资料\n\n保留原文');
  const result = await importSourceFile(file);
  assert.equal(result.format, 'md');
  assert.equal(result.originalPath, file);
  assert.equal(result.rawText, '# 合成资料\n\n保留原文');
  await assert.rejects(importSourceFile(join(own, 'missing.txt')), codeIs('FILE_UNREADABLE'));
});
