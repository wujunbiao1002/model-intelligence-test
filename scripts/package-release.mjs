#!/usr/bin/env node
// Builds two independently deployable zips under release/:
//   model-intelligence-test-web-<version>-<stamp>.zip      contents of out/, unzip straight into the nginx web dir
//   model-intelligence-test-monitor-<version>-<stamp>.zip  monitor.mjs + lib/ + config.example.json, unzip into the monitor dir
// Entries sit at the zip root so `unzip -o x.zip -d <target>` updates in place.
// The real monitor/config.json is never packaged. Run `npm run build` first.
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
const releaseDir = path.join(root, 'release');

try {
  await stat(path.join(root, 'out', 'index.html'));
} catch {
  console.error('[package] 没有找到 out/index.html，请先运行 npm run build');
  process.exit(1);
}

async function pack(kind, fill) {
  const name = `${pkg.name}-${kind}-${pkg.version}-${stamp}`;
  const stage = path.join(releaseDir, name);
  const zipFile = path.join(releaseDir, `${name}.zip`);
  await rm(stage, { recursive: true, force: true });
  await rm(zipFile, { force: true });
  await mkdir(stage, { recursive: true });
  await fill(stage);
  // bsdtar (Windows 10+, macOS, most Linux) writes forward-slash zip entries;
  // PowerShell 5.1 Compress-Archive writes backslashes that break unzip on Linux.
  execFileSync('tar', ['-a', '-c', '-f', zipFile, '-C', stage, '.'], { stdio: 'inherit' });
  await rm(stage, { recursive: true, force: true });
  const size = (await stat(zipFile)).size;
  console.log(`[package] ${path.relative(root, zipFile)}（${(size / 1024).toFixed(0)} KB）`);
}

await mkdir(releaseDir, { recursive: true });

await pack('web', async (stage) => {
  await cp(path.join(root, 'out'), stage, { recursive: true });
  // data/ on the server holds live monitor output; never ship a placeholder over it.
  await rm(path.join(stage, 'data'), { recursive: true, force: true });
});

await pack('monitor', async (stage) => {
  await cp(path.join(root, 'monitor', 'monitor.mjs'), path.join(stage, 'monitor.mjs'));
  await cp(path.join(root, 'monitor', 'lib'), path.join(stage, 'lib'), { recursive: true });
  await cp(path.join(root, 'monitor', 'config.example.json'), path.join(stage, 'config.example.json'));
});
