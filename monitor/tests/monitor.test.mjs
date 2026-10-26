import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const monitor = fileURLToPath(new URL('../monitor.mjs', import.meta.url));
const SVG = '<svg viewBox="0 0 10 10"><circle r="4"/></svg>';

function sse(chunks) {
  return chunks.map((content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`).join('') + 'data: [DONE]\n\n';
}

async function withServer(handler, fn) {
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => { requests.push({ auth: req.headers.authorization, body: JSON.parse(body) }); handler(req, res, requests.length); });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { return await fn(`http://127.0.0.1:${server.address().port}/v1`, requests); } finally { server.close(); }
}

async function setup(baseUrl, groups, extra = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'pelican-'));
  const config = path.join(dir, 'config.json');
  await writeFile(config, JSON.stringify({ baseUrl, outputDir: path.join(dir, 'out'), prompt: '画鹈鹕', historySize: 2, groups, ...extra }));
  return { dir, config, out: path.join(dir, 'out') };
}

test('monitor writes status, keeps history size, and never leaks keys', async () => {
  await withServer((req, res, n) => {
    if (n === 2) { res.writeHead(500); res.end(JSON.stringify({ error: { message: 'bad key sk-secret-aaaaaaaaaaaa' } })); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(sse(['```svg\n', SVG.slice(0, 20), SVG.slice(20), '\n```']));
  }, async (baseUrl, requests) => {
    const env = await setup(baseUrl, [{ id: 'g1', name: '分组一', apiKey: 'sk-secret-aaaaaaaaaaaa', model: 'm1', effort: 'high' }]);
    try {
      for (let i = 0; i < 3; i++) await run(process.execPath, [monitor, '--config', env.config]);
      const status = JSON.parse(await readFile(path.join(env.out, 'status.json'), 'utf8'));
      const group = status.groups[0];
      assert.equal(group.round, 3);
      assert.equal(group.runs.length, 2);
      assert.deepEqual(group.runs.map((r) => r.status), ['ok', 'failed']);
      assert.equal(group.state, 'ok');
      assert.equal(await readFile(path.join(env.out, group.runs[0].file), 'utf8'), SVG);
      assert.equal((await readdir(path.join(env.out, 'runs', 'g1'))).length, 1);
      assert.ok(!JSON.stringify(status).includes('sk-secret'));
      assert.equal(requests[0].body.reasoning_effort, 'high');
      assert.equal(requests[0].auth, 'Bearer sk-secret-aaaaaaaaaaaa');
    } finally { await rm(env.dir, { recursive: true, force: true }); }
  });
});

test('monitor marks a reply without artwork as failed and skips disabled groups', async () => {
  await withServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(sse(['抱歉，我无法完成']));
  }, async (baseUrl, requests) => {
    const env = await setup(baseUrl, [
      { id: 'g1', name: 'A', apiKey: 'sk-a', model: 'm1' },
      { id: 'g2', name: 'B', apiKey: 'sk-b', model: 'm2', enabled: false },
    ]);
    try {
      const { stdout } = await run(process.execPath, [monitor, '--config', env.config]);
      const status = JSON.parse(await readFile(path.join(env.out, 'status.json'), 'utf8'));
      assert.equal(status.groups.length, 1);
      assert.equal(status.groups[0].runs[0].status, 'failed');
      assert.equal(status.groups[0].runs[0].error, undefined);
      assert.match(stdout, /^\[\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\] \[monitor\] g1 第 1 轮 失败：回复中没有找到/m);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].body.reasoning_effort, undefined);
    } finally { await rm(env.dir, { recursive: true, force: true }); }
  });
});

test('monitor rejects unsafe group ids', async () => {
  const env = await setup('http://127.0.0.1:1/v1', [{ id: '../x', name: 'A', apiKey: 'sk-a', model: 'm' }]);
  try {
    await assert.rejects(run(process.execPath, [monitor, '--config', env.config]), /只能包含/);
  } finally { await rm(env.dir, { recursive: true, force: true }); }
});
