import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createAssistantApiMiddleware } from './assistant-api';
import type { RuntimeConfig } from './runtime-config';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.wasm': 'application/wasm', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.pdf': 'application/pdf',
};

function reply(res: ServerResponse, status: number, message: string) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ error: message }));
}

async function serveAsset(req: IncomingMessage, res: ServerResponse, distDir: string) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); return reply(res, 405, 'Method not allowed'); }
  let pathname: string;
  try { pathname = decodeURIComponent((req.url ?? '/').split('?')[0]); } catch { return reply(res, 400, 'Invalid path'); }
  const parts = pathname.split('/');
  if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0') || parts.some(part => part.startsWith('.')) || pathname.endsWith('.map')) {
    return reply(res, 404, 'Not found');
  }
  if (pathname.startsWith('/api/')) return reply(res, 404, 'Unknown API');
  let file = path.join(distDir, pathname === '/' ? 'index.html' : pathname);
  let info;
  try { info = await stat(file); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    if (path.extname(pathname) || !req.headers.accept?.includes('text/html')) return reply(res, 404, 'Not found');
    file = path.join(distDir, 'index.html');
    info = await stat(file);
  }
  if (!info.isFile()) return reply(res, 404, 'Not found');
  const resolved = await realpath(file);
  const relative = path.relative(distDir, resolved);
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) return reply(res, 404, 'Not found');
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') { res.end(); return; }
  await pipeline(createReadStream(resolved), res);
}

export async function createProductionServer(config: RuntimeConfig) {
  const distDir = await realpath(config.distDir);
  if (!(await stat(path.join(distDir, 'index.html'))).isFile()) throw new Error('Missing production build. Run npm run build first.');
  const assistant = createAssistantApiMiddleware(config);
  const server = createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if ((req.url === '/healthz') && (req.method === 'GET' || req.method === 'HEAD')) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : '{"status":"ok"}');
      return;
    }
    assistant(req, res, () => {
      void serveAsset(req, res, distDir).catch(() => {
        if (!res.headersSent) reply(res, 500, 'Unable to serve this resource');
        else res.destroy();
      });
    });
  });
  server.requestTimeout = 60_000;
  server.headersTimeout = 15_000;
  return server;
}
