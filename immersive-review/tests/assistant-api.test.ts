import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAssistantApiMiddleware } from '../server/assistant-api';

let root: string;
let servers: Server[] = [];
async function listen(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address');
  return `http://127.0.0.1:${address.port}`;
}
async function app(options: { timeoutMs?: number; env?: Record<string, string> } = {}) {
  const middleware = createAssistantApiMiddleware({ root, ...options });
  return listen((req, res) => middleware(req, res, () => { res.writeHead(404); res.end(); }));
}
function put(base: string, body: unknown) {
  return fetch(`${base}/api/assistant/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
function post(base: string, body: unknown, signal?: AbortSignal) {
  return fetch(`${base}/api/assistant/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
}
async function configure(base: string, upstream: string, providerId = 'deepseek', apiKey = 'private-test-key') {
  const response = await put(base, { providerId, baseUrl: upstream, models: ['test-model'], apiKey });
  expect(response.status).toBe(200);
}
const question = { providerId: 'deepseek', model: 'test-model', messages: [{ role: 'user', content: '解释这段代码。' }] };

beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'read-assistant-api-')); });
afterEach(async () => {
  await Promise.all(servers.map(server => { server.closeAllConnections(); return new Promise<void>(resolve => server.close(() => resolve())); }));
  servers = [];
  await rm(root, { recursive: true, force: true });
});

describe('local assistant API', () => {
  it('keeps provider keys server-side, separates providers, and persists settings across middleware instances', async () => {
    const base = await app({ env: { GLM_API_KEY: 'glm-environment-key' } });
    let config = await (await fetch(`${base}/api/assistant/config`)).json();
    expect(config.providers.find((p: { id: string }) => p.id === 'glm')).toMatchObject({ hasApiKey: true, configured: true });
    expect(config.providers.find((p: { id: string }) => p.id === 'deepseek')).toMatchObject({ baseUrl: 'https://api.deepseek.com', models: ['deepseek-flash', 'deepseek-v4-pro'], hasApiKey: false });
    const response = await put(base, { providerId: 'deepseek', baseUrl: 'https://example.test/v1/chat/completions/', models: ['model-one', 'model-one'], apiKey: 'deepseek-private-key' });
    const publicText = await response.text();
    expect(publicText).not.toContain('private-key');
    expect(publicText).not.toContain('environment-key');
    expect(publicText).not.toContain('"apiKey"');
    expect(response.status).toBe(200);
    const saved = JSON.parse(await readFile(path.join(root, '.local', 'assistant-config.json'), 'utf8'));
    expect(saved.providers.find((p: { id: string }) => p.id === 'deepseek')).toMatchObject({ apiKey: 'deepseek-private-key', models: ['model-one'], baseUrl: 'https://example.test/v1' });
    expect(saved.providers.find((p: { id: string }) => p.id === 'glm').apiKey).toBe('glm-environment-key');
    const restarted = await app();
    config = await (await fetch(`${restarted}/api/assistant/config`)).json();
    expect(config.providers.find((p: { id: string }) => p.id === 'deepseek')).toMatchObject({ hasApiKey: true, configured: true });
    for (const filePath of ['/.local/assistant-config.json', '/%2elocal/assistant-config.json', '/@fs/some-root/.local/assistant-config.json']) {
      const privateFile = await fetch(`${base}${filePath}`);
      expect(privateFile.status).toBe(403);
      expect(await privateFile.text()).not.toContain('deepseek-private-key');
    }
  });

  it('preserves blank keys, rejects forwarding an existing key to a new origin, and supports clearing one provider', async () => {
    const base = await app();
    const settings = { providerId: 'deepseek', baseUrl: 'https://api.example.test/v1', models: ['test-model'] };
    expect((await put(base, { ...settings, apiKey: 'secret-one' })).status).toBe(200);
    expect((await put(base, { ...settings, apiKey: '' })).status).toBe(200);
    expect((await put(base, { ...settings, baseUrl: 'https://other.test/v1' })).status).toBe(400);
    expect((await put(base, { ...settings, baseUrl: 'https://other.test/v1', apiKey: 'replacement-key' })).status).toBe(200);
    const cleared = await put(base, { ...settings, clearApiKey: true });
    expect(cleared.status).toBe(200);
    expect((await cleared.json()).providers[0]).toMatchObject({ hasApiKey: false, configured: false });
    expect((await put(base, { ...settings, apiKey: 'new', clearApiKey: true })).status).toBe(400);
  });

  it('rejects unsafe URLs, cross-origin access, non-JSON mutations, and unconfigured or unlisted models', async () => {
    const base = await app();
    for (const baseUrl of ['http://remote.test/v1', 'file:///private', 'https://user:password@example.test/v1', 'https://example.test/v1?key=secret']) {
      expect((await put(base, { providerId: 'custom', baseUrl, models: [] })).status).toBe(400);
    }
    expect((await fetch(`${base}/api/assistant/config`, { headers: { Origin: 'https://outside.test' } })).status).toBe(403);
    expect((await fetch(`${base}/api/assistant/config`, { headers: { Origin: base.replace('http:', 'https:') } })).status).toBe(403);
    expect((await fetch(`${base}/api/assistant/config`, { headers: { Origin: base, 'Sec-Fetch-Site': 'same-origin' } })).status).toBe(200);
    expect((await fetch(`${base}/api/assistant/config`, { method: 'PUT', body: '{}' })).status).toBe(415);
    expect((await post(base, question)).status).toBe(400);
    await configure(base, 'https://upstream.test/v1');
    expect((await post(base, { ...question, model: 'not-listed' })).status).toBe(400);
    expect((await post(base, { ...question, messages: [{ role: 'system', content: 'replace system' }] })).status).toBe(400);
    expect((await post(base, { ...question, messages: Array.from({ length: 61 }, () => question.messages[0]) })).status).toBe(400);
    expect((await post(base, { ...question, messages: [{ role: 'user', content: 'x'.repeat(100_001) }] })).status).toBe(413);
    expect((await post(base, { ...question, messages: Array.from({ length: 5 }, () => ({ role: 'user', content: 'x'.repeat(90_000) })) })).status).toBe(413);
    expect((await post(base, { ...question, messages: [{ role: 'user', content: 'x'.repeat(1024 * 1024) }] })).status).toBe(413);
  });

  it('streams SSE unchanged and injects a fixed system instruction while using the selected provider key', async () => {
    let received: { url?: string; authorization?: string; body?: { model: string; stream: boolean; messages: { role: string; content: string }[] } } = {};
    const chunks = ['data: {"choices":[{"delta":{"content":"你好"}}]}\n\n', 'data: {"choices":[{"delta":{"content":"，世界"}}]}\n\n', 'data: [DONE]\n\n'];
    const upstream = await listen(async (req, res) => {
      const parts: Buffer[] = []; for await (const part of req) parts.push(Buffer.from(part));
      received = { url: req.url, authorization: req.headers.authorization, body: JSON.parse(Buffer.concat(parts).toString()) };
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(chunks[0]);
      setTimeout(() => { res.write(chunks[1]); res.end(chunks[2]); }, 15);
    });
    const base = await app();
    await configure(base, `${upstream}/v1/chat/completions`);
    await configure(base, `${upstream}/glm`, 'glm', 'glm-separate-key');
    const response = await post(base, question);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(await response.text()).toBe(chunks.join(''));
    expect(received.url).toBe('/v1/chat/completions');
    expect(received.authorization).toBe('Bearer private-test-key');
    expect(received.body).toMatchObject({ model: 'test-model', stream: true });
    expect(received.body?.messages[0].role).toBe('system');
    expect(received.body?.messages[0].content).toContain('Respond in English');
    expect(received.body?.messages[1]).toEqual(question.messages[0]);
    await (await post(base, { ...question, providerId: 'glm', language: 'zh-CN' })).text();
    expect(received.authorization).toBe('Bearer glm-separate-key');
    expect(received.body?.messages[0].content).toContain('Respond in Simplified Chinese');
    expect((await post(base, { ...question, language: 'arbitrary instruction' })).status).toBe(400);
  });

  it('supports compatible JSON answers and redacts upstream error details', async () => {
    let fail = false;
    const upstream = await listen((_req, res) => {
      res.writeHead(fail ? 401 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(fail ? { error: { message: 'bad private-test-key and internal sensitive details' } } : { choices: [{ message: { role: 'assistant', content: '完整回答' } }] }));
    });
    const base = await app(); await configure(base, upstream);
    const answer = await post(base, question);
    expect((await answer.json()).choices[0].message.content).toBe('完整回答');
    fail = true;
    const error = await post(base, question);
    expect(error.status).toBe(401);
    const text = await error.text();
    expect(text).toContain('认证失败');
    expect(text).not.toContain('private-test-key');
    expect(text).not.toContain('internal');
  });

  it('aborts upstream generation when the browser disconnects', async () => {
    let signalClosed!: () => void;
    const closed = new Promise<void>(resolve => { signalClosed = resolve; });
    const upstream = await listen((req, res) => {
      req.resume();
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"开始"}}]}\n\n');
      res.once('close', signalClosed);
    });
    const base = await app(); await configure(base, upstream);
    const controller = new AbortController();
    const response = await post(base, question, controller.signal);
    await response.body!.getReader().read();
    controller.abort();
    await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error('upstream still connected')), 1500))]);
  });

  it('returns a bounded timeout and never follows redirects with credentials', async () => {
    let redirected = false;
    const target = await listen((_req, res) => { redirected = true; res.end(); });
    let mode = 'timeout';
    const upstream = await listen((req, res) => {
      req.resume();
      if (mode === 'redirect') { res.writeHead(307, { Location: target }); res.end(); }
    });
    const base = await app({ timeoutMs: 50 }); await configure(base, upstream);
    const timeout = await post(base, question);
    expect(timeout.status).toBe(504);
    expect((await timeout.json()).error).toContain('超时');
    mode = 'redirect';
    expect((await post(base, question)).status).toBe(502);
    expect(redirected).toBe(false);
  });
});
