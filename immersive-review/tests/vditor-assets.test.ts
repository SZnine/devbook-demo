import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { ResolvedConfig, ViteDevServer } from 'vite';
import { vditorMathAssetsPlugin } from '../server/vditor-assets';

describe('local editor math assets', () => {
  it('includes the renderer, chemistry extension, and every font referenced by the stylesheet in builds', async () => {
    const plugin = vditorMathAssetsPlugin();
    const emitted = new Map<string, string>();
    if (typeof plugin.generateBundle !== 'function') throw new Error('Missing build hook');
    await plugin.generateBundle.call({ emitFile: (asset: { fileName: string; source: Uint8Array }) => {
      emitted.set(asset.fileName, Buffer.from(asset.source).toString());
      return asset.fileName;
    } } as never, {} as never, {}, false);
    const prefix = 'vendor/vditor/dist/js/katex/';
    expect(emitted.get(prefix + 'katex.min.js')).toContain('renderToString');
    expect(emitted.get(prefix + 'mhchem.min.js')).toContain('mhchem');
    const css = emitted.get(prefix + 'katex.min.css')!;
    const fonts = [...css.matchAll(/url\(["']?([^\)"']+)["']?\)/g)].map(match => match[1]);
    expect(fonts.length).toBeGreaterThan(0);
    for (const font of fonts) expect(emitted.has(prefix + font), font).toBe(true);
  });

  it('serves Vditor versioned requests under the app base and leaves other paths alone', async () => {
    const plugin = vditorMathAssetsPlugin();
    if (typeof plugin.configResolved !== 'function' || typeof plugin.configureServer !== 'function') throw new Error('Missing dev hooks');
    await plugin.configResolved.call({} as never, { base: '/read/' } as ResolvedConfig);
    let middleware!: (request: IncomingMessage, response: ServerResponse, next: () => void) => void;
    await plugin.configureServer.call({} as never, { middlewares: { use: (handler: typeof middleware) => { middleware = handler; } } } as ViteDevServer);
    const server = createServer((request, response) => middleware(request, response, () => {
      response.statusCode = 404;
      response.end();
    }));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');
    const root = `http://127.0.0.1:${address.port}`;
    try {
      const script = await fetch(root + '/read/vendor/vditor/dist/js/katex/katex.min.js?v=0.16.9');
      expect(script.status).toBe(200);
      expect(script.headers.get('content-type')).toContain('javascript');
      expect(await script.text()).toContain('renderToString');
      const font = await fetch(root + '/read/vendor/vditor/dist/js/katex/fonts/KaTeX_Main-Regular.woff2');
      expect(font.status).toBe(200);
      expect(font.headers.get('content-type')).toBe('font/woff2');
      expect((await font.arrayBuffer()).byteLength).toBeGreaterThan(0);
      const head = await fetch(root + '/read/vendor/vditor/dist/js/katex/mhchem.min.js', { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(await head.text()).toBe('');
      expect((await fetch(root + '/read/vendor/vditor/dist/js/katex/package.json')).status).toBe(404);
      expect((await fetch(root + '/read/notes')).status).toBe(404);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
