import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { PriorityApiError, requestMemoryPriority, validatePriorityRequest } from './memory-priority';

type ProviderId = 'deepseek' | 'glm' | 'custom';
type Provider = { id: ProviderId; name: string; baseUrl: string; models: string[]; apiKey: string };
type Message = { role: 'user' | 'assistant'; content: string };
export type MiddlewareOptions = {
  root: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  dataDir?: string;
  allowedOrigins?: string[];
  maxBodyBytes?: number;
};
type Next = (error?: unknown) => void;

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_REPLY_BYTES = 16 * 1024 * 1024;
function systemPrompt(language: unknown) {
  if (language !== undefined && language !== 'en' && language !== 'zh-CN') throw new ApiError(400, 'Unsupported interface language.');
  const responseLanguage = language === 'zh-CN' ? 'Simplified Chinese' : 'English';
  return `You help with the user's reading and notes. Respond in ${responseLanguage} unless the user requests another language. Use Markdown where useful. Distinguish source material from your interpretation. You can offer suggestions, but cannot edit, move or save the user's notes.`;
}

class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function isLoopback(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1' || hostname === '::ffff:127.0.0.1';
}

function normalizeBaseUrl(input: unknown): string {
  if (typeof input !== 'string' || input.length > 2048) throw new ApiError(400, '请填写有效的 API 地址。');
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new ApiError(400, '请填写完整的 API 地址。'); }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) {
    throw new ApiError(400, 'API 地址需要使用 HTTPS；本机服务可使用 HTTP。');
  }
  if (url.username || url.password || url.search || url.hash) throw new ApiError(400, 'API 地址不能包含用户名、密码、查询参数或片段。');
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  return url.toString().replace(/\/+$/, '');
}

function validateModels(input: unknown): string[] {
  if (!Array.isArray(input) || input.length > 30) throw new ApiError(400, '模型列表最多可设置 30 项。');
  const models = input.map(value => {
    if (typeof value !== 'string' || !value.trim() || value.length > 200 || /[\x00-\x1f\x7f]/.test(value)) {
      throw new ApiError(400, '请填写有效的模型名称。');
    }
    return value.trim();
  });
  return [...new Set(models)];
}

function validateKey(input: unknown): string {
  if (typeof input !== 'string' || input.length > 8192 || /[\x00-\x1f\x7f]/.test(input)) throw new ApiError(400, 'API Key 格式无效。');
  return input.trim();
}

function defaults(env: Record<string, string | undefined>): Provider[] {
  const providers: Provider[] = [
    { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', models: ['deepseek-flash', 'deepseek-v4-pro'], apiKey: env.DEEPSEEK_API_KEY?.trim() ?? '' },
    { id: 'glm', name: 'GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-5.3-flash', 'glm-5.3', 'glm-5.3-flashx'], apiKey: env.GLM_API_KEY?.trim() ?? '' },
    { id: 'custom', name: '自定义', baseUrl: 'https://api.openai.com/v1', models: [], apiKey: env.CUSTOM_AI_API_KEY?.trim() ?? '' },
  ];
  for (const provider of providers) {
    const prefix = provider.id === 'custom' ? 'CUSTOM_AI' : provider.id.toUpperCase();
    const baseUrl = env[`${prefix}_BASE_URL`]?.trim();
    const models = env[`${prefix}_MODELS`]?.trim();
    if (baseUrl) provider.baseUrl = normalizeBaseUrl(baseUrl);
    if (models) provider.models = validateModels(models.split(',').map(model => model.trim()).filter(Boolean));
    provider.apiKey = validateKey(provider.apiKey);
  }
  return providers;
}

function publicConfig(providers: Provider[]) {
  return { providers: providers.map(({ apiKey, ...provider }) => ({ ...provider, hasApiKey: Boolean(apiKey), configured: Boolean(apiKey && provider.models.length) })) };
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}

function guardRequest(req: IncomingMessage, allowedOrigins?: string[]) {
  const host = req.headers.host;
  let requestUrl: URL;
  try { requestUrl = new URL(`http://${host}`); } catch { throw new ApiError(403, '只允许从本机工作台访问助手。'); }
  if (allowedOrigins) {
    if (!host || !allowedOrigins.some(origin => new URL(origin).host === requestUrl.host)) throw new ApiError(403, '请从已配置的工作台地址访问助手。');
  } else if (!host || !isLoopback(requestUrl.hostname) || !isLoopback(req.socket.remoteAddress ?? '')) throw new ApiError(403, '只允许从本机工作台访问助手。');
  const origin = req.headers.origin;
  if (origin) {
    let originUrl: URL;
    try { originUrl = new URL(origin); } catch { throw new ApiError(403, '请求来源无效。'); }
    const protocol = 'encrypted' in req.socket && req.socket.encrypted ? 'https:' : 'http:';
    if (originUrl.host !== requestUrl.host || (allowedOrigins ? !allowedOrigins.includes(originUrl.origin) : originUrl.protocol !== protocol)) throw new ApiError(403, '请从当前工作台发起请求。');
  }
  if (req.headers['sec-fetch-site'] === 'cross-site') throw new ApiError(403, '请从当前工作台发起请求。');
  if (req.method !== 'GET' && !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) throw new ApiError(415, '请求必须使用 JSON 格式。');
}

async function readJson(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size <= maxBytes) chunks.push(Buffer.from(chunk));
  }
  if (size > maxBytes) throw new ApiError(413, '发送内容超过服务器允许的大小，请减少内容后重试。');
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ApiError(400, '请求内容不是有效的 JSON。'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, '请求内容格式无效。');
  return body as Record<string, unknown>;
}

function validateMessages(input: unknown): Message[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 60) throw new ApiError(400, '一次对话需要包含 1 至 60 条消息，请新建对话后继续。');
  let total = 0;
  const messages = input.map(value => {
    if (!value || typeof value !== 'object' || !['user', 'assistant'].includes(value.role) || typeof value.content !== 'string' || !value.content.trim()) {
      throw new ApiError(400, '消息需要包含有效的角色和正文。');
    }
    if (value.content.length > 100_000) throw new ApiError(413, '单条消息超过 10 万字符，请减少内容后重试。');
    total += value.content.length;
    return { role: value.role, content: value.content } as Message;
  });
  if (total > 400_000) throw new ApiError(413, '对话累计超过 40 万字符，请新建对话或减少内容。');
  if (messages.at(-1)?.role !== 'user') throw new ApiError(400, '最后一条消息必须是用户提问。');
  return messages;
}

function upstreamError(status: number) {
  if (status === 401 || status === 403) return 'API 认证失败，请检查该服务的 API Key 和访问权限。';
  if (status === 429) return '服务暂时限流或额度不足，请检查账户额度后重试。';
  if (status === 404) return 'API 地址或模型不存在，请检查设置。';
  if (status === 400 || status === 422) return '模型未接受本次请求，请检查模型名称或减少发送内容。';
  return `AI 服务暂时无法响应（${status}），请稍后重试。`;
}

export function createAssistantApiMiddleware(options: MiddlewareOptions) {
  const configFile = path.join(options.dataDir ?? path.join(options.root, '.local'), 'assistant-config.json');
  let providersPromise: Promise<Provider[]> | undefined;
  let writeQueue = Promise.resolve();
  function loadProviders() {
    return providersPromise ??= (async () => {
      const providers = defaults(options.env ?? {});
      let saved: unknown;
      try { saved = JSON.parse(await readFile(configFile, 'utf8')); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return providers;
        throw new ApiError(500, '无法读取助手配置，请检查数据目录中的 assistant-config.json。');
      }
      if (!saved || typeof saved !== 'object' || !Array.isArray((saved as { providers?: unknown }).providers)) throw new ApiError(500, '本机助手配置格式无效。');
      for (const provider of providers) {
        const entry = (saved as { providers: Provider[] }).providers.find(value => value?.id === provider.id);
        if (!entry) continue;
        provider.baseUrl = normalizeBaseUrl(entry.baseUrl);
        provider.models = validateModels(entry.models);
        provider.apiKey = validateKey(entry.apiKey);
      }
      return providers;
    })();
  }

  async function saveConfig(body: Record<string, unknown>) {
    const run = writeQueue.then(async () => {
      const providers = await loadProviders();
      const previous = providers.find(provider => provider.id === body.providerId);
      if (!previous) throw new ApiError(400, '请选择有效的 AI 服务。');
      const baseUrl = normalizeBaseUrl(body.baseUrl);
      const models = validateModels(body.models);
      if (body.clearApiKey !== undefined && typeof body.clearApiKey !== 'boolean') throw new ApiError(400, '清除密钥选项格式无效。');
      const replacement = body.apiKey === undefined ? '' : validateKey(body.apiKey);
      if (replacement && body.clearApiKey) throw new ApiError(400, '不能同时替换和清除 API Key。');
      if (new URL(baseUrl).origin !== new URL(previous.baseUrl).origin && previous.apiKey && !replacement && !body.clearApiKey) {
        throw new ApiError(400, '更换 API 域名时，请重新填写 API Key 或清除原密钥。');
      }
      const next = providers.map(provider => provider.id === previous.id ? { ...provider, baseUrl, models, apiKey: body.clearApiKey ? '' : replacement || previous.apiKey } : provider);
      await mkdir(path.dirname(configFile), { recursive: true });
      const temporary = `${configFile}.tmp`;
      await writeFile(temporary, JSON.stringify({ providers: next }, null, 2), { mode: 0o600 });
      await rename(temporary, configFile);
      providersPromise = Promise.resolve(next);
      return publicConfig(next);
    });
    writeQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  async function chat(req: IncomingMessage, res: ServerResponse, body: Record<string, unknown>) {
    const provider = (await loadProviders()).find(item => item.id === body.providerId);
    if (!provider) throw new ApiError(400, '请选择有效的 AI 服务。');
    if (!provider.apiKey || !provider.models.length) throw new ApiError(400, '请先在助手设置中填写该服务的 API Key 和模型。');
    if (typeof body.model !== 'string' || !provider.models.includes(body.model)) throw new ApiError(400, '所选模型未配置，请在助手设置中添加或重新选择。');
    const messages = validateMessages(body.messages);
    const instruction = systemPrompt(body.language);
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? 180_000);
    const disconnect = () => { if (!res.writableEnded) controller.abort(); };
    req.on('aborted', disconnect);
    res.on('close', disconnect);
    try {
      const upstream = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}`, Accept: 'text/event-stream, application/json' },
        body: JSON.stringify({ model: body.model, stream: true, messages: [{ role: 'system', content: instruction }, ...messages] }),
      });
      if (!upstream.ok) {
        await upstream.body?.cancel();
        throw new ApiError(upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502, upstreamError(upstream.status));
      }
      const contentType = upstream.headers.get('content-type') ?? '';
      const isStream = contentType.includes('text/event-stream');
      if (!isStream && !contentType.includes('application/json')) {
        await upstream.body?.cancel();
        throw new ApiError(502, '服务返回了不支持的内容，请检查 API 地址是否为兼容接口。');
      }
      if (!upstream.body) throw new ApiError(502, 'AI 服务没有返回内容。');
      const reader = upstream.body.getReader();
      let size = 0;
      if (isStream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' });
        res.flushHeaders();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_REPLY_BYTES) throw new ApiError(502, '回答超过长度限制，请缩小问题范围后重试。');
          if (!res.write(value)) await new Promise<void>(resolve => {
            const settle = () => { res.off('drain', settle); res.off('close', settle); controller.signal.removeEventListener('abort', settle); resolve(); };
            res.once('drain', settle); res.once('close', settle);
            controller.signal.addEventListener('abort', settle, { once: true });
          });
          if (controller.signal.aborted) throw new Error('aborted');
          if (res.destroyed) break;
        }
        if (!res.destroyed) res.end();
      } else {
        const chunks: Uint8Array[] = [];
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_REPLY_BYTES) throw new ApiError(502, '回答超过长度限制，请缩小问题范围后重试。');
          chunks.push(value);
        }
        let reply: unknown;
        try { reply = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ApiError(502, 'AI 服务返回了无法解析的回答。'); }
        json(res, 200, reply);
      }
    } catch (error) {
      controller.abort();
      if (res.destroyed) return;
      const failure = timedOut ? new ApiError(504, '等待回答超时，已停止本次连接；你可以稍后重试。') : error instanceof ApiError ? error : new ApiError(502, '无法连接 AI 服务，请检查 API 地址和网络后重试。');
      if (res.headersSent) { res.write(`data: ${JSON.stringify({ error: failure.message })}\n\n`); res.end(); }
      else throw failure;
    } finally {
      clearTimeout(timer);
      req.off('aborted', disconnect);
      res.off('close', disconnect);
    }
  }

  async function memoryPriority(req: IncomingMessage, res: ServerResponse, body: Record<string, unknown>) {
    const request = validatePriorityRequest(body);
    const provider = (await loadProviders()).find(item => item.id === request.providerId);
    if (!provider) throw new ApiError(400, '请选择有效的 AI 服务。');
    if (!provider.apiKey || !provider.models.length) throw new ApiError(400, '请先在助手设置中填写该服务的 API Key 和模型。');
    if (!provider.models.includes(request.model)) throw new ApiError(400, '所选模型未配置，请在助手设置中添加或重新选择。');
    if (req.aborted || res.destroyed) return;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? 180_000);
    const disconnect = () => { if (!res.writableEnded) controller.abort(); };
    req.on('aborted', disconnect);
    res.on('close', disconnect);
    try {
      const result = await requestMemoryPriority(request, provider, controller.signal);
      if (!res.destroyed) json(res, 200, result);
    } catch (error) {
      controller.abort();
      if (res.destroyed) return;
      if (timedOut) throw new ApiError(504, '评分超时，未保存任何评分；可以稍后重试。');
      if (error instanceof PriorityApiError) throw error;
      throw new ApiError(502, '无法连接 AI 服务，请检查 API 地址和网络后重试。');
    } finally {
      clearTimeout(timer);
      req.off('aborted', disconnect);
      res.off('close', disconnect);
    }
  }

  return function middleware(req: IncomingMessage, res: ServerResponse, next: Next) {
    const pathname = req.url?.split('?')[0];
    let decodedPath = pathname ?? '';
    try { decodedPath = decodeURIComponent(decodedPath).replaceAll('\\', '/'); } catch { /* Vite handles malformed URLs. */ }
    // This folder contains credentials and must never be served as a project asset.
    if (/(?:^|\/)\.local(?:\/|$)/i.test(decodedPath)) { json(res, 403, { error: '不能通过网页访问本机私有配置。' }); return; }
    if (pathname !== '/api/assistant/config' && pathname !== '/api/assistant/chat' && pathname !== '/api/assistant/memory-priority') { next(); return; }
    void (async () => {
      guardRequest(req, options.allowedOrigins);
      if (pathname === '/api/assistant/config' && req.method === 'GET') return json(res, 200, publicConfig(await loadProviders()));
      if (pathname === '/api/assistant/config' && req.method === 'PUT') return json(res, 200, await saveConfig(await readJson(req, options.maxBodyBytes)));
      if (pathname === '/api/assistant/chat' && req.method === 'POST') return chat(req, res, await readJson(req, options.maxBodyBytes));
      if (pathname === '/api/assistant/memory-priority' && req.method === 'POST') return memoryPriority(req, res, await readJson(req, options.maxBodyBytes));
      throw new ApiError(405, '该接口不支持此请求方式。');
    })().catch(error => {
      if (res.destroyed || res.writableEnded) return;
      const failure = error instanceof ApiError || error instanceof PriorityApiError ? error : new ApiError(500, '本机助手服务暂时不可用，请稍后重试。');
      json(res, failure.status, { error: failure.message });
    });
  };
}
