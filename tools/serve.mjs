#!/usr/bin/env node
// Zero-dependency static file server for Expedition 69 (npm start → http://localhost:8069).
// Usage: node tools/serve.mjs [--port N] [--root DIR] [--host HOST] [--quiet]
// Serves with correct MIME types and no-cache headers; directories serve index.html (or a listing).

import { createServer as createHttpServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Default port. */
export const DEFAULT_PORT = 8069;
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Extension → Content-Type. */
export const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
});

const NO_CACHE = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
};

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function send(res, status, body, type = 'text/plain; charset=utf-8', headOnly = false) {
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), ...NO_CACHE });
  res.end(headOnly ? undefined : body);
}

async function listing(res, dir, urlPath, headOnly) {
  const entries = (await readdir(dir, { withFileTypes: true }))
    .filter((e) => !e.name.startsWith('.'))
    .sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
  const items = entries.map((e) => {
    const name = e.name + (e.isDirectory() ? '/' : '');
    return `<li><a href="${encodeURI(urlPath + name)}">${escapeHtml(name)}</a></li>`;
  });
  const up = urlPath !== '/' ? '<li><a href="../">../</a></li>' : '';
  const html = `<!doctype html><meta charset="utf-8"><title>Index of ${escapeHtml(urlPath)}</title>
<style>body{font:15px/1.5 Georgia,serif;background:#15100d;color:#f5eedf;padding:24px 32px}a{color:#e0b458}</style>
<h1>Index of ${escapeHtml(urlPath)}</h1><ul>${up}${items.join('')}</ul>`;
  send(res, 200, html, MIME_TYPES['.html'], headOnly);
}

/**
 * Create (but don't start) the static server.
 * @param {{root?:string, quiet?:boolean}} [opts]
 * @returns {import('node:http').Server}
 */
export function createStaticServer({ root = PROJECT_ROOT, quiet = false } = {}) {
  const base = path.resolve(root);
  return createHttpServer(async (req, res) => {
    const started = Date.now();
    const headOnly = req.method === 'HEAD';
    const log = (status) => {
      if (!quiet) console.log(`${new Date().toISOString().slice(11, 19)} ${status} ${req.method} ${req.url} ${Date.now() - started}ms`);
    };
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        send(res, 405, 'Method Not Allowed', undefined, headOnly);
        return log(405);
      }
      const url = new URL(req.url ?? '/', 'http://localhost');
      let urlPath;
      try {
        urlPath = decodeURIComponent(url.pathname);
      } catch {
        send(res, 400, 'Bad Request', undefined, headOnly);
        return log(400);
      }
      const filePath = path.resolve(base, `.${path.posix.normalize(urlPath)}`);
      if (filePath !== base && !filePath.startsWith(base + path.sep)) {
        send(res, 403, 'Forbidden', undefined, headOnly);
        return log(403);
      }
      let info;
      try {
        info = await stat(filePath);
      } catch {
        send(res, 404, `404 Not Found: ${urlPath}`, undefined, headOnly);
        return log(404);
      }
      let target = filePath;
      if (info.isDirectory()) {
        if (!urlPath.endsWith('/')) {
          res.writeHead(301, { Location: `${url.pathname}/${url.search}`, ...NO_CACHE });
          res.end();
          return log(301);
        }
        target = path.join(filePath, 'index.html');
        try {
          info = await stat(target);
        } catch {
          await listing(res, filePath, urlPath, headOnly);
          return log(200);
        }
      }
      const type = MIME_TYPES[path.extname(target).toLowerCase()] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': info.size, ...NO_CACHE });
      if (headOnly) {
        res.end();
        return log(200);
      }
      const stream = createReadStream(target);
      stream.on('error', () => res.destroy());
      stream.pipe(res);
      log(200);
    } catch (err) {
      if (!res.headersSent) send(res, 500, 'Internal Server Error', undefined, headOnly);
      else res.destroy();
      if (!quiet) console.error(err);
    }
  });
}

/**
 * Start serving and resolve once listening.
 * @param {{port?:number, host?:string, root?:string, quiet?:boolean}} [opts]
 * @returns {Promise<{server:import('node:http').Server, url:string, port:number, close:() => Promise<void>}>}
 */
export function serve({ port = DEFAULT_PORT, host = '127.0.0.1', root = PROJECT_ROOT, quiet = false } = {}) {
  const server = createStaticServer({ root, quiet });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      const actual = server.address().port;
      const shownHost = host === '0.0.0.0' || host === '::' || host === '127.0.0.1' ? 'localhost' : host;
      resolve({
        server,
        port: actual,
        url: `http://${shownHost}:${actual}/`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

function parseArgs(argv) {
  const opts = { port: DEFAULT_PORT, host: '127.0.0.1', root: PROJECT_ROOT, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--port' || a === '-p') opts.port = Number(next());
    else if (a.startsWith('--port=')) opts.port = Number(a.slice(7));
    else if (a === '--root' || a === '-r') opts.root = path.resolve(next());
    else if (a.startsWith('--root=')) opts.root = path.resolve(a.slice(7));
    else if (a === '--host') opts.host = next();
    else if (a.startsWith('--host=')) opts.host = a.slice(7);
    else if (a === '--quiet' || a === '-q') opts.quiet = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node tools/serve.mjs [--port N] [--root DIR] [--host HOST] [--quiet]');
      process.exit(0);
    }
  }
  if (!Number.isInteger(opts.port) || opts.port < 0 || opts.port > 65535) {
    console.error(`Invalid --port: ${opts.port}`);
    process.exit(2);
  }
  return opts;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  serve(opts).then(({ url }) => {
    console.log(`Expedition 69 serving ${opts.root}`);
    console.log(`  → ${url}`);
  }).catch((err) => {
    if (err.code === 'EADDRINUSE') console.error(`Port ${opts.port} is already in use. Try: node tools/serve.mjs --port ${opts.port + 1}`);
    else console.error(err);
    process.exit(1);
  });
  const shutdown = () => process.exit(0);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
