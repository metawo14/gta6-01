// A tiny static server for the game folder, Node standard library only.
// Serves game/ on 127.0.0.1:8080 (or --port), with the right MIME types for the kinds of file
// the game ships, no path outside game/, 404 for anything missing and no-store caching.
// A development convenience, not a production server.

import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(join(here, 'game'));
const HOST = '127.0.0.1';

const MIME = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.webm': 'video/webm',
}));

function parsePort(argv) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port' || arg === '-p') {
      const value = Number(argv[i + 1]);
      if (Number.isInteger(value) && value > 0 && value < 65536) return value;
    }
    const inline = /^--port=(\d+)$/.exec(arg);
    if (inline) {
      const value = Number(inline[1]);
      if (Number.isInteger(value) && value > 0 && value < 65536) return value;
    }
  }
  return 8080;
}

// Resolve a URL path to a file under ROOT, refusing anything that climbs out.
function resolveTarget(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return { status: 400, reason: 'bad request' };
  }
  if (decoded === '' || decoded === '/') decoded = '/index.html';
  const rel = normalize(decoded).replace(/^([/\\])+/, '');
  const target = resolve(join(ROOT, rel));
  if (target !== ROOT && !target.startsWith(ROOT + sep)) {
    return { status: 403, reason: 'forbidden' };
  }
  return { status: 200, target, rel };
}

const port = parsePort(process.argv.slice(2));

const server = createServer((req, res) => {
  const found = resolveTarget(req.url ?? '/');
  if (found.status !== 200) {
    res.writeHead(found.status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end(found.reason);
    return;
  }
  let stat;
  try {
    stat = statSync(found.target);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end('not found');
    return;
  }
  if (!stat.isFile()) {
    // A directory request goes to its index.html when there is one.
    const indexPath = join(found.target, 'index.html');
    try {
      const indexStat = statSync(indexPath);
      if (indexStat.isFile()) {
        serveFile(indexPath, res);
        return;
      }
    } catch { /* fall through to 404 */ }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end('not found');
    return;
  }
  serveFile(found.target, res);
});

function serveFile(path, res) {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end('not found');
    return;
  }
  const type = MIME.get(extname(path).toLowerCase()) ?? 'application/octet-stream';
  res.writeHead(200, {
    'content-type': type,
    'content-length': stat.size,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  if (res.req?.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = createReadStream(path);
  stream.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    }
    res.end('read error');
  });
  stream.pipe(res);
}

server.listen(port, HOST, () => {
  console.log(`Port Meridian — serving game/ at http://${HOST}:${port}/`);
  console.log('Press Ctrl-C to stop.');
});
