import { t, getLanguage } from '../i18n';
import { assistantErrorMessage } from './assistant-errors';
import { demoAiNotice, IS_DEMO_MODE } from '../demo';

export type AssistantProviderId = 'deepseek' | 'glm' | 'custom';

export interface AssistantProvider {
  id: AssistantProviderId;
  name: string;
  baseUrl: string;
  models: string[];
  hasApiKey: boolean;
  configured: boolean;
}

export interface AssistantConfig {
  providers: AssistantProvider[];
}

export interface ApiMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantConfigUpdate {
  providerId: AssistantProviderId;
  baseUrl: string;
  models: string[];
  apiKey?: string;
  clearApiKey?: boolean;
}

export interface AssistantChatRequest {
  providerId: AssistantProviderId;
  model: string;
  messages: ApiMessage[];
}

function abortError() {
  return new DOMException(t("已停止生成", "Response stopped"), 'AbortError');
}

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

function errorMessage(value: unknown, fallback: string): string {
  if (!value || typeof value !== 'object') return fallback;
  const error = (value as { error?: unknown }).error;
  const message = typeof error === 'string' ? error
    : error && typeof error === 'object' && 'message' in error ? error.message : undefined;
  return typeof message === 'string' && message.trim()
    ? assistantErrorMessage(message.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300))
    : fallback;
}

async function requireSuccess(response: Response) {
  if (response.ok) return;
  let payload: unknown;
  try { payload = await response.json(); } catch { /* Never show an upstream HTML error page. */ }
  throw new Error(errorMessage(payload, t(`请求失败（${response.status}），请检查 API 设置后重试。`, `Request failed (${response.status}). Check provider settings.`)));
}

export async function getAssistantConfig(signal?: AbortSignal): Promise<AssistantConfig> {
  checkAbort(signal);
  if (IS_DEMO_MODE) return { providers: [] };
  const response = await fetch('/api/assistant/config', { signal, credentials: 'same-origin' });
  await requireSuccess(response);
  return response.json() as Promise<AssistantConfig>;
}

export async function saveAssistantConfig(
  config: AssistantConfigUpdate,
  signal?: AbortSignal,
): Promise<AssistantConfig> {
  checkAbort(signal);
  if (IS_DEMO_MODE) throw new Error(demoAiNotice());
  const response = await fetch('/api/assistant/config', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
    signal,
  });
  await requireSuccess(response);
  return response.json() as Promise<AssistantConfig>;
}

type ReplyChoice = {
  index?: number;
  delta?: { content?: unknown; refusal?: unknown };
  message?: { content?: unknown; refusal?: unknown };
  finish_reason?: string | null;
};

function firstChoice(payload: unknown): ReplyChoice | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return undefined;
  return choices.find(choice => choice && typeof choice === 'object' && (choice.index === 0 || choice.index === undefined));
}

function checkFinish(reason?: string | null) {
  if (reason === 'length') throw new Error(t("回答已达到输出长度限制，当前内容可能不完整。", "Response reached the length limit and may be incomplete."));
  if (reason === 'content_filter') throw new Error(t("服务商已停止输出，当前回答受到内容过滤限制。", "The provider stopped this response due to content filtering."));
  if (reason === 'tool_calls' || reason === 'function_call') throw new Error(t("模型请求了工具调用，当前聊天仅支持文字回答。", "This model requested a tool. Only text responses are supported."));
  if (reason && reason !== 'stop') throw new Error(t("模型未正常完成回答，请检查服务商返回状态。", "The model did not complete its response."));
}

/** Streams only the public answer; provider reasoning fields are intentionally ignored. */
export async function streamAssistantReply(
  request: AssistantChatRequest,
  { signal, onDelta }: { signal?: AbortSignal; onDelta: (text: string) => void },
): Promise<void> {
  checkAbort(signal);
  if (IS_DEMO_MODE) throw new Error(demoAiNotice());
  const response = await fetch('/api/assistant/chat', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' },
    body: JSON.stringify({ ...request, language: getLanguage() }),
    signal,
  });
  await requireSuccess(response);
  checkAbort(signal);
  let answer = '';
  const append = (value: unknown) => {
    checkAbort(signal);
    if (typeof value !== 'string' || !value) return;
    answer += value;
    onDelta(value);
  };

  if (response.headers.get('content-type')?.includes('application/json')) {
    const payload: unknown = await response.json();
    checkAbort(signal);
    if (payload && typeof payload === 'object' && 'error' in payload) {
      throw new Error(errorMessage(payload, t("服务商未能完成回答。", "The provider could not complete the response.")));
    }
    const choice = firstChoice(payload);
    append(choice?.message?.content);
    append(choice?.message?.refusal);
    checkFinish(choice?.finish_reason);
    if (!answer.trim()) throw new Error(t("服务商未返回可显示的回答。", "The provider returned an empty response."));
    return;
  }

  if (!response.body) throw new Error(t("未收到回答数据流，请重试。", "No response stream. Try again."));
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  let event = '';
  let done = false;
  let finished = false;
  let reachedEnd = false;
  const onAbort = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener('abort', onAbort, { once: true });

  const dispatch = () => {
    const body = data.join('\n');
    const eventType = event;
    data = [];
    event = '';
    if (!body.trim()) {
      if (eventType === 'error') throw new Error(t("回答连接发生错误。", "The response connection failed."));
      return;
    }
    if (body.trim() === '[DONE]') { done = true; return; }
    let payload: unknown;
    try { payload = JSON.parse(body); }
    catch { throw new Error(t("回答数据格式异常，连接已停止。", "Invalid response data. Connection stopped.")); }
    if (eventType === 'error' || (payload && typeof payload === 'object' && 'error' in payload)) {
      throw new Error(errorMessage(payload, t("回答连接发生错误。", "The response connection failed.")));
    }
    const choice = firstChoice(payload);
    append(choice?.delta?.content);
    append(choice?.delta?.refusal);
    checkFinish(choice?.finish_reason);
    if (choice?.finish_reason) finished = true;
  };

  const consumeLine = (line: string) => {
    if (!line) { dispatch(); return; }
    if (line.startsWith(':')) return;
    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    let value = separator < 0 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') data.push(value);
    if (field === 'event') event = value;
  };

  const consumeBuffer = (atEnd = false) => {
    while (!done) {
      const index = buffer.search(/[\r\n]/);
      if (index < 0 || (buffer[index] === '\r' && index === buffer.length - 1 && !atEnd)) break;
      const line = buffer.slice(0, index);
      const separatorLength = buffer[index] === '\r' && buffer[index + 1] === '\n' ? 2 : 1;
      buffer = buffer.slice(index + separatorLength);
      consumeLine(line);
    }
    if (atEnd && !done) {
      if (buffer) consumeLine(buffer);
      buffer = '';
      dispatch();
    }
  };

  try {
    checkAbort(signal);
    while (!done) {
      const chunk = await reader.read();
      checkAbort(signal);
      if (chunk.done) {
        reachedEnd = true;
        buffer += decoder.decode();
        consumeBuffer(true);
        break;
      }
      buffer += decoder.decode(chunk.value, { stream: true });
      consumeBuffer();
    }
    checkAbort(signal);
    if (!done && !finished) throw new Error(t("回答连接中断，已收到的内容可能不完整。", "Connection interrupted. The response may be incomplete."));
    if (!answer.trim()) throw new Error(t("服务商未返回可显示的回答。", "The provider returned an empty response."));
  } catch (error) {
    if (signal?.aborted) throw abortError();
    throw error;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    if (!reachedEnd) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
