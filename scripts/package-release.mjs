#!/usr/bin/env node
// Assembles release/model-intelligence-test-<version>-<date>/ from the built out/ and the monitor sources,
// then zips it. Run `npm run build` first. The real monitor/config.json is never packaged.
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const now = new Date();
const stamp = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((n) => String(n).padStart(2, '0')).join('')
  + '-' + [now.getHours(), now.getMinutes()].map((n) => String(n).padStart(2, '0')).join('');
const name = `${pkg.name}-${pkg.version}-${stamp}`;
const releaseDir = path.join(root, 'release');
const stage = path.join(releaseDir, name);
const zipFile = path.join(releaseDir, `${name}.zip`);

try {
  await stat(path.join(root, 'out', 'index.html'));
} catch {
  console.error('[package] 没有找到 out/index.html，请先运行 npm run build');
  process.exit(1);
}

await rm(stage, { recursive: true, force: true });
await rm(zipFile, { force: true });
await mkdir(stage, { recursive: true });

await cp(path.join(root, 'out'), path.join(stage, 'web'), { recursive: true });
await rm(path.join(stage, 'web', 'data'), { recursive: true, force: true });

await mkdir(path.join(stage, 'monitor'), { recursive: true });
await cp(path.join(root, 'monitor', 'monitor.mjs'), path.join(stage, 'monitor', 'monitor.mjs'));
await cp(path.join(root, 'monitor', 'lib'), path.join(stage, 'monitor', 'lib'), { recursive: true });
await cp(path.join(root, 'monitor', 'config.example.json'), path.join(stage, 'monitor', 'config.example.json'));

await cp(path.join(root, 'nginx-config.conf'), path.join(stage, 'nginx-config.conf'));
await cp(path.join(root, 'DEPLOY.md'), path.join(stage, 'DEPLOY.md'));

// bsdtar (bundled with Windows 10+, macOS, most Linux) writes forward-slash zip entries;
// PowerShell 5.1 Compress-Archive writes backslashes that break unzip on Linux.
execFileSync('tar', ['-a', '-c', '-f', zipFile, '-C', releaseDir, name], { stdio: 'inherit' });

const size = (await stat(zipFile)).size;
console.log(`[package] ${path.relative(root, zipFile)}（${(size / 1024).toFixed(0)} KB）`);
