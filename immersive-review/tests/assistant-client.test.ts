import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getAssistantConfig,
  saveAssistantConfig,
  streamAssistantReply,
  type AssistantChatRequest,
} from '../src/notebook/assistant-client';

afterEach(() => vi.unstubAllGlobals());

const request: AssistantChatRequest = {
  providerId: 'deepseek',
  model: 'deepseek-chat',
  messages: [{ role: 'user', content: '解释这个例子。' }],
};
const delta = (content: string) => JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] });
const finish = (reason = 'stop') => JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: reason }] });

function streamResponse(text: string, chunkSize = 1000) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize));
      controller.close();
    },
  }), { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
}

function mockResponse(response: Response) {
  const fetcher = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

describe('assistant API client', () => {
  it('loads safe provider configuration and saves only the selected provider update', async () => {
    const config = { providers: [{ id: 'glm', name: 'GLM', baseUrl: 'https://example.com/v1', models: ['glm-test'], hasApiKey: true, configured: true }] };
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(Response.json(config)));
    vi.stubGlobal('fetch', fetcher);
    expect(await getAssistantConfig()).toEqual(config);
    const update = { providerId: 'glm' as const, baseUrl: 'https://example.com/v1', models: ['glm-test'], apiKey: 'test-key' };
    expect(await saveAssistantConfig(update)).toEqual(config);
    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/assistant/config', expect.objectContaining({ credentials: 'same-origin' }));
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/assistant/config', expect.objectContaining({ method: 'PUT', body: JSON.stringify(update) }));
  });

  it.each(['\n', '\r\n', '\r'])('decodes split Unicode and SSE lines using %j separators', async newline => {
    const fetcher = mockResponse(streamResponse(`: heartbeat${newline}id: 1${newline}data: ${delta('你好 👋')}${newline}${newline}data:${delta('\n世界')}${newline}${newline}data: [DONE]${newline}${newline}`, 1));
    const chunks: string[] = [];
    await streamAssistantReply(request, { onDelta: text => chunks.push(text) });
    expect(chunks.join('')).toBe('你好 👋\n世界');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith('/api/assistant/chat', expect.objectContaining({ body: JSON.stringify(request), credentials: 'same-origin' }));
  });

  it('joins multiple data lines and accepts a final finish_reason without DONE', async () => {
    mockResponse(streamResponse(`data: {"choices":[\ndata: {"delta":{"content":"answer"}}]}\n\ndata: ${finish()}`, 3));
    const onDelta = vi.fn();
    await streamAssistantReply(request, { onDelta });
    expect(onDelta).toHaveBeenCalledExactlyOnceWith('answer');
  });

  it('ignores reasoning and additional choices, but displays public refusal text', async () => {
    const payload = { choices: [
      { index: 0, delta: { reasoning_content: 'private thinking', reasoning: 'private reasoning', refusal: '无法提供这个回答。' } },
      { index: 1, delta: { content: 'alternative' } },
    ] };
    mockResponse(streamResponse(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`));
    const onDelta = vi.fn();
    await streamAssistantReply(request, { onDelta });
    expect(onDelta).toHaveBeenCalledExactlyOnceWith('无法提供这个回答。');
  });

  it('retains partial output and reports unexpected EOF instead of success or retrying', async () => {
    const fetcher = mockResponse(streamResponse(`data: ${delta('partial')}\n\n`));
    const onDelta = vi.fn();
    await expect(streamAssistantReply(request, { onDelta })).rejects.toThrow('连接中断');
    expect(onDelta).toHaveBeenCalledExactlyOnceWith('partial');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    ['length', '长度限制'],
    ['content_filter', '内容过滤'],
    ['tool_calls', '工具调用'],
  ])('reports the non-success finish reason %s', async (reason, message) => {
    mockResponse(streamResponse(`data: ${delta('partial')}\n\ndata: ${finish(reason)}\n\ndata: [DONE]\n\n`));
    const onDelta = vi.fn();
    await expect(streamAssistantReply(request, { onDelta })).rejects.toThrow(message);
    expect(onDelta).toHaveBeenCalledExactlyOnceWith('partial');
  });

  it('surfaces a sanitized server error after partial output', async () => {
    mockResponse(streamResponse(`data: ${delta('partial')}\n\nevent: error\ndata: {"error":{"message":"额度不足\\n请检查设置"}}\n\n`));
    await expect(streamAssistantReply(request, { onDelta: vi.fn() })).rejects.toThrow('额度不足 请检查设置');
  });

  it('does not expose an HTML error response', async () => {
    const fetcher = mockResponse(new Response('<html>upstream internals</html>', { status: 502 }));
    await expect(streamAssistantReply(request, { onDelta: vi.fn() })).rejects.toThrow('请求失败（502）');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each(['data: [DONE]\n\n', `data: ${finish()}\n\n`])('rejects completed streams without public answer text', async content => {
    mockResponse(streamResponse(content));
    await expect(streamAssistantReply(request, { onDelta: vi.fn() })).rejects.toThrow('可显示的回答');
  });

  it('rejects malformed SSE payloads and missing bodies', async () => {
    mockResponse(streamResponse('data: not json\n\n'));
    await expect(streamAssistantReply(request, { onDelta: vi.fn() })).rejects.toThrow('数据格式异常');
    mockResponse(new Response(null));
    await expect(streamAssistantReply(request, { onDelta: vi.fn() })).rejects.toThrow('数据流');
  });

  it('supports JSON completion fallback and ignores JSON reasoning content', async () => {
    mockResponse(Response.json({ choices: [{ message: { content: '普通回答', reasoning_content: 'private' }, finish_reason: 'stop' }] }));
    const onDelta = vi.fn();
    await streamAssistantReply(request, { onDelta });
    expect(onDelta).toHaveBeenCalledExactlyOnceWith('普通回答');
  });

  it('checks incomplete and empty JSON answers', async () => {
    mockResponse(Response.json({ choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] }));
    await expect(streamAssistantReply(request, { onDelta: vi.fn() })).rejects.toThrow('长度限制');
    mockResponse(Response.json({ choices: [{ message: { content: '' }, finish_reason: 'stop' }] }));
    await expect(streamAssistantReply(request, { onDelta: vi.fn() })).rejects.toThrow('可显示的回答');
  });

  it('propagates HTTP configuration errors', async () => {
    mockResponse(Response.json({ error: '请先填写 API Key。' }, { status: 400 }));
    await expect(getAssistantConfig()).rejects.toThrow('请先填写 API Key');
  });

  it('does not start an already cancelled request', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    controller.abort();
    await expect(streamAssistantReply(request, { signal: controller.signal, onDelta: vi.fn() })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('cancels a pending read on abort and releases the stream lock', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    mockResponse(new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }));
    const controller = new AbortController();
    const pending = streamAssistantReply(request, { signal: controller.signal, onDelta: vi.fn() });
    await vi.waitFor(() => expect(body.locked).toBe(true));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it('cancels the unread remainder when DONE is reached', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode(`data: ${delta('complete')}\n\ndata: [DONE]\n\n`)); },
      cancel,
    });
    mockResponse(new Response(body));
    await streamAssistantReply(request, { onDelta: vi.fn() });
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });
});
