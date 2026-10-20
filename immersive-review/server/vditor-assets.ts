import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';

const assetPrefix = 'vendor/vditor/dist/js/katex/';

/** Vditor loads these fixed URLs; source them from the same KaTeX as the reader. */
export function vditorMathAssetsPlugin(): Plugin {
  const katexDist = dirname(createRequire(import.meta.url).resolve('katex'));
  const sources = [
    ['katex.min.js', 'katex.min.js', 'text/javascript; charset=utf-8'],
    ['katex.min.css', 'katex.min.css', 'text/css; charset=utf-8'],
    ['mhchem.min.js', 'contrib/mhchem.min.js', 'text/javascript; charset=utf-8'],
    ...readdirSync(join(katexDist, 'fonts')).filter(name => /\.(woff2?|ttf)$/.test(name)).map(name => [
      `fonts/${name}`, `fonts/${name}`, name.endsWith('.woff2') ? 'font/woff2' : name.endsWith('.woff') ? 'font/woff' : 'font/ttf',
    ]),
  ];
  const assets = new Map(sources.map(([name, path, type]) => [assetPrefix + name, {
    content: readFileSync(join(katexDist, path)), type,
  }]));
  let base = '/';

  return {
    name: 'local-vditor-math-assets',
    configResolved(config) { base = new URL(config.base, 'http://localhost/').pathname; },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') return next();
        const pathname = new URL(request.url || '/', 'http://localhost/').pathname;
        const filename = pathname.startsWith(base) ? pathname.slice(base.length) : pathname.slice(1);
        const asset = assets.get(filename);
        if (!asset) return next();
        response.statusCode = 200;
        response.setHeader('Content-Type', asset.type);
        response.setHeader('Content-Length', asset.content.length);
        response.setHeader('Cache-Control', 'no-cache');
        response.end(request.method === 'HEAD' ? undefined : asset.content);
      });
    },
    generateBundle() {
      for (const [fileName, asset] of assets) this.emitFile({ type: 'asset', fileName, source: asset.content });
    },
  };
}
