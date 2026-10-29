import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UPSTREAM = process.env.UPSTREAM || '';
const HOP_HEADERS = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2' };

function json(res, status, error) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(error));
}

function headersWithoutHop(headers) {
  const excluded = new Set([...HOP_HEADERS, ...(headers.connection || '').split(',').map((name) => name.trim().toLowerCase())]);
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !excluded.has(name)));
}

function within(root, path) {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
}

function forward(req, res, url, upstream, timeoutMs) {
  const target = new URL(upstream.origin);
  target.pathname = url.pathname;
  target.search = url.search;
  const headers = headersWithoutHop(req.headers);
  for (const name of ['host', 'origin', 'referer', 'cookie', 'forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto']) delete headers[name];
  const request = upstream.protocol === 'https:' ? httpsRequest : httpRequest;
  const remote = request(target, { method: req.method, headers }, (response) => {
    if (response.statusCode >= 300 && response.statusCode < 400) {
      response.resume();
      json(res, 502, { error: 'Upstream redirected the API request; check the API route.' });
      return;
    }
    const forwarded = headersWithoutHop(response.headers);
    delete forwarded['set-cookie'];
    for (const name of Object.keys(forwarded)) if (name.startsWith('access-control-')) delete forwarded[name];
    forwarded['cache-control'] = 'no-store';
    res.writeHead(response.statusCode || 502, forwarded);
    res.flushHeaders();
    response.on('error', () => res.destroy());
    response.pipe(res);
  });
  remote.setTimeout(timeoutMs, () => remote.destroy(Object.assign(new Error('Upstream timeout'), { code: 'ETIMEDOUT' })));
  remote.on('error', (error) => {
    if (res.destroyed) return;
    if (res.headersSent) { res.destroy(); return; }
    json(res, error.code === 'ETIMEDOUT' ? 504 : 502, { error: 'Cannot reach upstream. Check network or retry.' });
  });
  req.on('aborted', () => remote.destroy());
  req.on('error', () => remote.destroy());
  res.on('close', () => remote.destroy());
  req.pipe(remote);
}

// Mirrors the nginx alias: /model-intelligence-test/data/ is served from the monitor output, not out/.
export function createLocalServer({ root = resolve(PROJECT, 'out'), dataRoot = resolve(PROJECT, 'public/data'), upstream = UPSTREAM, timeoutMs = 300_000 } = {}) {
  const target = new URL(upstream);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new Error('Invalid upstream');
  const server = createServer(async (req, res) => {
    const port = server.address()?.port;
    const allowedHosts = new Set(['127.0.0.1:' + port, 'localhost:' + port]);
    if (!allowedHosts.has(req.headers.host)) { json(res, 403, { error: 'Local access only' }); return; }
    const origin = 'http://' + req.headers.host;
    if (!req.url?.startsWith('/') || req.url.startsWith('//')) { json(res, 400, { error: 'Invalid path' }); return; }
    let url;
    try { url = new URL(req.url, origin); } catch { json(res, 400, { error: 'Invalid URL' }); return; }
    if (url.pathname === '/_local/health') {
      json(res, 200, { service: 'model-intelligence-test-local', upstream: target.origin }); return;
    }
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/v1/') || url.pathname.startsWith('/login')) {
      if ((req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') {
        json(res, 403, { error: 'Use the local page for API requests' }); return;
      }
      forward(req, res, url, target, timeoutMs); return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { json(res, 405, { error: 'Method not allowed' }); return; }
    if (url.pathname === '/' || url.pathname === '/model-intelligence-test') {
      res.writeHead(302, { location: '/model-intelligence-test/' + url.search, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
      res.end(); return;
    }
    if (!url.pathname.startsWith('/model-intelligence-test/')) { json(res, 404, { error: 'Not found' }); return; }
    try {
      let path = decodeURIComponent(url.pathname.slice('/model-intelligence-test/'.length));
      if (path.includes(String.fromCharCode(92)) || path.includes(':') || path.split('/').some((part) => part.startsWith('.'))) {
        json(res, 403, { error: 'Invalid file path' }); return;
      }
      const isData = path.startsWith('data/');
      if (isData) path = path.slice('data/'.length);
      const base = await realpath(isData ? dataRoot : root);
      let file = resolve(base, path);
      if (!within(base, file)) { json(res, 403, { error: 'Invalid file path' }); return; }
      let info = await stat(file);
      if (info.isDirectory()) { file = resolve(file, 'index.html'); info = await stat(file); }
      file = await realpath(file);
      if (!within(base, file) || !info.isFile()) { json(res, 403, { error: 'Invalid file path' }); return; }
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream',
        'content-length': info.size, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' });
      if (req.method === 'HEAD') { res.end(); return; }
      const stream = createReadStream(file);
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    } catch (error) {
      if (!res.headersSent) json(res, error instanceof URIError ? 400 : 404, { error: 'Static file not found. Run npm run build (or npm run monitor:local for data/).' });
      else res.destroy();
    }
  });
  return server;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: UPSTREAM=https://your-sub2api.example.com npm run preview -- [--port 3210]');
    console.log('Serves out/ at /model-intelligence-test/ and forwards /api/ and /v1/ to $UPSTREAM.');
    return;
  }
  if (!UPSTREAM) throw new Error('Set UPSTREAM to your sub2api origin, e.g. UPSTREAM=https://your-sub2api.example.com');
  if (args.length && (args.length !== 2 || args[0] !== '--port')) throw new Error('Only --port <number> is supported');
  let port = args.length ? Number(args[1]) : 3210;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port must be 1024-65535');
  await stat(resolve(PROJECT, 'out/index.html')).catch(() => { throw new Error('Missing out/index.html. Run npm run build first.'); });
  const server = createLocalServer();
  for (let attempt = 0; ; attempt++, port++) {
    try {
      await new Promise((resolveListen, reject) => {
        const failed = (error) => reject(error);
        server.once('error', failed);
        server.listen(port, '127.0.0.1', () => { server.off('error', failed); resolveListen(); });
      });
      break;
    } catch (error) {
      if (error.code !== 'EADDRINUSE' || args.length || attempt >= 9) throw error;
    }
  }
  console.log('Model Intelligence Test: http://127.0.0.1:' + port + '/model-intelligence-test/');
  console.log('API upstream: ' + UPSTREAM + ' (Bearer authentication required)');
  console.log('Use a fresh login link with the origin changed to the local address.');
  const stop = () => { server.close(); server.closeAllConnections(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.code === 'EADDRINUSE' ? 'Port is busy; choose another --port.' : error.message);
    process.exitCode = 1;
  });
}
