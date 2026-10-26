#!/usr/bin/env node
// Runs one detection round for every enabled group, then exits. Schedule it with cron.
// Writes <outputDir>/status.json and <outputDir>/runs/<groupId>/<runId>.<svg|html> for nginx to serve.
import { mkdir, readFile, readdir, rename, rm, writeFile, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { extractArtifact } from './lib/artifact.mjs';
import { EFFORTS, runChat } from './lib/chat.mjs';

const { values: args } = parseArgs({
  options: {
    config: { type: 'string', default: fileURLToPath(new URL('./config.json', import.meta.url)) },
    group: { type: 'string', multiple: true },
    output: { type: 'string' },
  },
});

const GROUP_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

// Server-local time, e.g. 2026-10-26 14:52:07, so log lines line up with cron schedules.
function timestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function log(message) {
  console.log(`[${timestamp()}] [monitor] ${message}`);
}

function fail(message) {
  console.error(`[${timestamp()}] [monitor] ${message}`);
  process.exit(1);
}

async function loadConfig(file) {
  let config;
  try { config = JSON.parse(await readFile(file, 'utf8')); } catch (error) {
    fail(`无法读取配置 ${file}：${error.message}`);
  }
  if (!config.baseUrl || !config.outputDir || !config.prompt) fail('配置缺少 baseUrl / outputDir / prompt');
  if (!Array.isArray(config.groups) || config.groups.length === 0) fail('配置 groups 不能为空');
  const ids = new Set();
  for (const group of config.groups) {
    if (!GROUP_ID.test(group.id || '')) fail(`分组 id "${group.id}" 只能包含小写字母、数字、- 和 _`);
    if (ids.has(group.id)) fail(`分组 id "${group.id}" 重复`);
    ids.add(group.id);
    if (!group.name || !group.model) fail(`分组 ${group.id} 缺少 name / model`);
    if (group.enabled !== false && !group.apiKey) fail(`分组 ${group.id} 缺少 apiKey`);
    if (group.effort && !EFFORTS.includes(group.effort)) fail(`分组 ${group.id} 的 effort 必须是 ${EFFORTS.join(' / ')}`);
  }
  return {
    title: '系统检测',
    notice: '',
    intervalMinutes: 15,
    historySize: 6,
    timeoutSeconds: 600,
    concurrency: 3,
    ...config,
  };
}

async function acquireLock(file) {
  try {
    const handle = await open(file, 'wx');
    await handle.writeFile(String(process.pid));
    await handle.close();
    return true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const pid = Number(await readFile(file, 'utf8').catch(() => ''));
  if (pid > 0) {
    try { process.kill(pid, 0); return false; } catch { /* holder is gone */ }
  }
  await rm(file, { force: true });
  return acquireLock(file);
}

function redact(message, keys) {
  let text = String(message || '未知错误');
  for (const key of keys) if (key && key.length > 8) text = text.split(key).join('sk-***');
  return text.replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***').slice(0, 500);
}

async function main() {
  const config = await loadConfig(args.config);
  const outputDir = path.resolve(args.output || config.outputDir);
  const runsDir = path.join(outputDir, 'runs');
  const statusFile = path.join(outputDir, 'status.json');
  const lockFile = path.join(outputDir, '.monitor.lock');
  await mkdir(runsDir, { recursive: true });

  if (!(await acquireLock(lockFile))) {
    log('上一轮检测仍在进行，跳过本轮');
    return;
  }
  const release = () => rm(lockFile, { force: true });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void release().finally(() => process.exit(130)); });

  try {
    let previous = { groups: [] };
    try { previous = JSON.parse(await readFile(statusFile, 'utf8')); } catch { /* first run */ }
    const previousById = new Map((previous.groups || []).map((group) => [group.id, group]));
    const selected = new Set(args.group || []);
    const shouldRun = (group) => group.enabled !== false && (selected.size === 0 || selected.has(group.id));
    const keys = config.groups.map((group) => group.apiKey);

    const startedAt = new Date().toISOString();
    const status = {
      version: 1,
      title: config.title,
      notice: config.notice,
      prompt: config.prompt,
      intervalMinutes: config.intervalMinutes,
      historySize: config.historySize,
      updatedAt: startedAt,
      nextUpdateAt: new Date(Date.parse(startedAt) + config.intervalMinutes * 60_000).toISOString(),
      groups: config.groups.filter((group) => group.enabled !== false).map((group) => {
        const old = previousById.get(group.id);
        // Drop error text left by older versions so it never gets republished.
        const runs = (old?.runs || []).map((run) => { const copy = { ...run }; delete copy.error; return copy; });
        const settled = runs[0] ? runs[0].status : 'idle';
        return {
          id: group.id,
          name: group.name,
          model: group.model,
          effort: group.effort || 'default',
          state: shouldRun(group) ? 'running' : (old?.state === 'running' ? settled : old?.state || settled),
          round: old?.round || 0,
          updatedAt: old?.updatedAt || null,
          runs,
        };
      }),
    };

    let writing = Promise.resolve();
    const save = () => {
      writing = writing.then(async () => {
        status.updatedAt = new Date().toISOString();
        const tmp = statusFile + '.tmp';
        await writeFile(tmp, JSON.stringify(status, null, 2));
        await rename(tmp, statusFile);
      });
      return writing;
    };
    await save();

    const active = new Set(status.groups.map((group) => group.id));
    for (const entry of await readdir(runsDir, { withFileTypes: true })) {
      if (entry.isDirectory() && GROUP_ID.test(entry.name) && !active.has(entry.name)) {
        await rm(path.join(runsDir, entry.name), { recursive: true, force: true });
      }
    }

    const runGroup = async (group) => {
      const entry = status.groups.find((item) => item.id === group.id);
      const round = entry.round + 1;
      const runId = startedAt.replace(/[-:.TZ]/g, '').slice(0, 14) + '-' + round;
      const begin = Date.now();
      let record;
      let failure = '';
      try {
        const result = await runChat({
          baseUrl: config.baseUrl,
          apiKey: group.apiKey,
          model: group.model,
          prompt: group.prompt || config.prompt,
          effort: group.effort,
          signal: AbortSignal.timeout(config.timeoutSeconds * 1000),
        });
        const artifact = extractArtifact(result.content);
        if (!artifact) throw new Error(result.content.trim() ? '回复中没有找到 SVG 或 HTML 作品' : '模型返回了空内容');
        const file = `runs/${group.id}/${runId}.${artifact.type}`;
        await mkdir(path.join(runsDir, group.id), { recursive: true });
        await writeFile(path.join(outputDir, file), artifact.content);
        record = { id: runId, status: 'ok', type: artifact.type, file, chars: artifact.content.length };
        if (result.usage) record.usage = { prompt: result.usage.prompt_tokens, completion: result.usage.completion_tokens };
      } catch (error) {
        const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
        // status.json is public; upstream error text can reveal accounts/models/infra, so it stays in the server log only.
        failure = timedOut ? `超过 ${config.timeoutSeconds} 秒未完成` : redact(error?.message, keys);
        record = { id: runId, status: 'failed' };
      }
      Object.assign(record, {
        round,
        model: group.model,
        effort: group.effort || 'default',
        startedAt: new Date(begin).toISOString(),
        durationMs: Date.now() - begin,
      });

      const runs = [record, ...entry.runs];
      for (const dropped of runs.slice(config.historySize)) {
        if (dropped.file) await rm(path.join(outputDir, dropped.file), { force: true });
      }
      Object.assign(entry, { runs: runs.slice(0, config.historySize), round, state: record.status, updatedAt: new Date().toISOString() });
      await save();
      log(`${group.id} 第 ${round} 轮 ${record.status === 'ok' ? '完成' : '失败：' + failure}（${Math.round(record.durationMs / 1000)}s）`);
    };

    const queue = config.groups.filter(shouldRun);
    const total = queue.length;
    log(`开始检测 ${total} 个分组（并发 ${config.concurrency}）`);
    let okCount = 0;
    const workers = Array.from({ length: Math.max(1, Math.min(config.concurrency, queue.length)) }, async () => {
      for (let group = queue.shift(); group; group = queue.shift()) {
        await runGroup(group);
        if (status.groups.find((item) => item.id === group.id)?.state === 'ok') okCount++;
      }
    });
    await Promise.all(workers);
    await writing;
    log(`本轮结束：成功 ${okCount}/${total}，耗时 ${Math.round((Date.now() - Date.parse(startedAt)) / 1000)}s`);
  } finally {
    await release();
  }
}

main().catch((error) => fail(error?.stack || String(error)));
