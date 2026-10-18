import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readRuntimeConfig } from '../server/runtime-config';
import { createProductionServer } from '../server/http-server';

let root: string;
let servers: Server[] = [];
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'read-production-'));
  await mkdir(path.join(root, 'dist', 'assets'), { recursive: true });
  await writeFile(path.join(root, 'dist', 'index.html'), '<html>Read production</html>');
  await writeFile(path.join(root, 'dist', 'assets', 'app-test.js'), 'console.log("Read")');
  await writeFile(path.join(root, 'private.json'), 'not-a-public-asset');
});
afterEach(async () => {
  await Promise.all(servers.map(server => { server.closeAllConnections(); return new Promise<void>(resolve => server.close(() => resolve())); }));
  servers = [];
  await rm(root, { recursive: true, force: true });
});

async function app(env: Record<string, string> = {}) {
  const config = readRuntimeConfig(env, root);
  const server = await createProductionServer(config);
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing server address');
  const url = `http://127.0.0.1:${address.port}`;
  config.allowedOrigins.push(url);
  return { url, config };
}

function rawGet(url: string, pathname: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const req = request(new URL(url), { path: pathname, headers }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(Buffer.from(chunk)));
      res.on('end', () => resolve({ status: res.statusCode!, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('production runtime', () => {
  it('validates runtime options without exposing supplied values', () => {
    expect(readRuntimeConfig({}, root)).toMatchObject({ host: '127.0.0.1', port: 5174, dataDir: path.join(root, '.local'), timeoutMs: 180000, maxBodyBytes: 1048576 });
    expect(readRuntimeConfig({ READ_PORT: '5310', READ_HOST: '0.0.0.0', READ_DATA_DIR: './settings', READ_ALLOWED_ORIGINS: 'https://read.example.test/,https://read.example.test' }, root)).toMatchObject({ port: 5310, dataDir: path.join(root, 'settings'), allowedOrigins: ['https://read.example.test'] });
    for (const env of [{ READ_PORT: '0' }, { READ_PORT: '5310suffix' }, { READ_AI_TIMEOUT_MS: '2' }, { READ_MAX_BODY_BYTES: '999999999' }, { READ_ALLOWED_ORIGINS: 'https://user:secret@example.test' }, { READ_ALLOWED_ORIGINS: 'https://example.test/path' }, { READ_ALLOWED_ORIGINS: '*' }, { READ_DATA_DIR: './dist' }, { READ_DATA_DIR: './dist/settings' }]) {
      expect(() => readRuntimeConfig(env, root)).toThrow();
    }
  });

  it('serves only build assets, supports health/HEAD and never falls back for APIs or private paths', async () => {
    const { url } = await app();
    expect(await (await fetch(`${url}/healthz`)).json()).toEqual({ status: 'ok' });
    const home = await fetch(url);
    expect(home.headers.get('content-type')).toContain('text/html');
    expect(home.headers.get('cache-control')).toBe('no-cache');
    expect(await home.text()).toContain('Read production');
    const asset = await fetch(`${url}/assets/app-test.js`);
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect(asset.headers.get('content-type')).toContain('javascript');
    const head = await fetch(`${url}/assets/app-test.js`, { method: 'HEAD' });
    expect(await head.text()).toBe('');
    expect(Number(head.headers.get('content-length'))).toBeGreaterThan(0);
    expect((await fetch(`${url}/book/test`, { headers: { Accept: 'text/html' } })).status).toBe(200);
    for (const pathname of ['/private.json', '/server/assistant-api.ts', '/.env', '/.git/config', '/%2e%2e/private.json', '/..%5cprivate.json', '/assets/app-test.js.map', '/api/no-such-endpoint']) {
      const response = await rawGet(url, pathname, { Accept: 'text/html' });
      expect(response.status, pathname).toBe(404);
      expect(response.text).not.toContain('not-a-public-asset');
      expect(response.text).not.toContain('Read production');
    }
    expect((await fetch(`${url}/.local/assistant-config.json`)).status).toBe(403);
    expect((await fetch(url, { method: 'POST' })).status).toBe(405);
  });

  it('persists API settings to the configured volume without returning keys and enforces trusted origins/body limits', async () => {
    const { url } = await app({ READ_DATA_DIR: 'settings-volume', READ_ALLOWED_ORIGINS: 'https://read.example.test', READ_MAX_BODY_BYTES: '2048', CUSTOM_AI_API_KEY: 'fixture-secret', CUSTOM_AI_BASE_URL: 'https://models.example.test/v1', CUSTOM_AI_MODELS: 'model-a,model-b' });
    const initial = await fetch(`${url}/api/assistant/config`);
    const initialText = await initial.text();
    expect(initialText).not.toContain('fixture-secret');
    expect(JSON.parse(initialText).providers[2]).toMatchObject({ baseUrl: 'https://models.example.test/v1', models: ['model-a', 'model-b'], configured: true });
    expect((await rawGet(url, '/api/assistant/config', { Host: 'evil.example', Origin: 'https://evil.example' })).status).toBe(403);
    expect((await rawGet(url, '/api/assistant/config', { Host: 'read.example.test', Origin: 'https://read.example.test' })).status).toBe(200);
    expect((await rawGet(url, '/api/assistant/config', { Host: 'read.example.test', Origin: 'http://read.example.test' })).status).toBe(403);
    expect((await rawGet(url, '/api/assistant/config', { Host: 'internal-proxy:5174', 'X-Forwarded-Host': 'read.example.test', 'X-Forwarded-Proto': 'https', Origin: 'https://read.example.test' })).status).toBe(403);
    expect((await fetch(`${url}/api/assistant/config`, { headers: { Origin: 'https://outside.example' } })).status).toBe(403);
    expect((await fetch(`${url}/api/assistant/config`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403);
    const saved = await fetch(`${url}/api/assistant/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: url }, body: JSON.stringify({ providerId: 'custom', baseUrl: 'https://models.example.test/v1', models: ['saved-model'], apiKey: '' }) });
    expect(saved.status).toBe(200);
    expect(await saved.text()).not.toContain('fixture-secret');
    const disk = JSON.parse(await readFile(path.join(root, 'settings-volume', 'assistant-config.json'), 'utf8'));
    expect(disk.providers[2].apiKey).toBe('fixture-secret');
    const restarted = await app({ READ_DATA_DIR: 'settings-volume' });
    expect((await (await fetch(`${restarted.url}/api/assistant/config`)).json()).providers[2]).toMatchObject({ models: ['saved-model'], configured: true });
    expect((await fetch(`${url}/api/assistant/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'x'.repeat(3000) }) })).status).toBe(413);
  });

  it('does not resurrect a cleared environment key after restart', async () => {
    const env = { READ_DATA_DIR: 'settings-volume', GLM_API_KEY: 'initial-environment-fixture' };
    const { url } = await app(env);
    const initial = (await (await fetch(`${url}/api/assistant/config`)).json()).providers.find((provider: { id: string }) => provider.id === 'glm');
    expect(initial.hasApiKey).toBe(true);
    const cleared = await fetch(`${url}/api/assistant/config`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 'glm', baseUrl: initial.baseUrl, models: initial.models, clearApiKey: true }),
    });
    expect(cleared.status).toBe(200);
    const restarted = await app(env);
    const configText = await (await fetch(`${restarted.url}/api/assistant/config`)).text();
    expect(configText).not.toContain('initial-environment-fixture');
    expect(JSON.parse(configText).providers.find((provider: { id: string }) => provider.id === 'glm')).toMatchObject({ hasApiKey: false, configured: false });
  });
});
