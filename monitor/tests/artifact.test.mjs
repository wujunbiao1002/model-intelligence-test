import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractArtifact, toDocument } from '../lib/artifact.mjs';
import { readChatStream } from '../lib/chat.mjs';

const SVG = '<svg viewBox="0 0 10 10"><circle r="4"/></svg>';

test('extracts bare and fenced svg', () => {
  assert.deepEqual(extractArtifact('好的：\n' + SVG + '\n完成'), { type: 'svg', content: SVG });
  assert.deepEqual(extractArtifact('```svg\n' + SVG + '\n```'), { type: 'svg', content: SVG });
});

test('prefers full html documents and ignores thinking', () => {
  const html = '<!DOCTYPE html><html><body>' + SVG + '</body></html>';
  assert.deepEqual(extractArtifact('<think>draft <svg></svg></think>```html\n' + html + '\n```'), { type: 'html', content: html });
});

test('treats svg with sibling style as html fragment', () => {
  const text = '<style>circle{fill:red}</style>' + SVG;
  assert.equal(extractArtifact(text)?.type, 'html');
});

test('returns null without artwork', () => {
  assert.equal(extractArtifact('抱歉'), null);
  assert.equal(extractArtifact('<svg unfinished'), null);
});

test('document wrapper carries a no-network CSP', () => {
  const doc = toDocument({ type: 'svg', content: SVG });
  assert.match(doc, /default-src 'none'/);
  assert.ok(doc.includes(SVG));
});

test('parses SSE split across chunks', async () => {
  const events = [
    'data: {"choices":[{"delta":{"reasoning_content":"想"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"<svg>"}}]}\n\ndata: {"choi',
    'ces":[{"delta":{"content":"</svg>"}}],"usage":{"prompt_tokens":3}}\n\ndata: [DONE]\n\n',
  ];
  const encoder = new TextEncoder();
  const body = new ReadableStream({ start(c) { for (const e of events) c.enqueue(encoder.encode(e)); c.close(); } });
  const result = await readChatStream(body);
  assert.equal(result.content, '<svg></svg>');
  assert.equal(result.reasoning, '想');
  assert.deepEqual(result.usage, { prompt_tokens: 3 });
});

test('surfaces in-stream errors', async () => {
  const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: {"error":{"message":"quota"}}\n\n')); c.close(); } });
  await assert.rejects(readChatStream(body), /quota/);
});
