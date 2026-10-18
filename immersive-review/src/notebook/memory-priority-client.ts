import type { AssistantProviderId } from './assistant-client';
import { DEMO_AI_NOTICE, IS_DEMO_MODE } from '../demo';

export const MEMORY_PRIORITY_RUBRIC_VERSION = 'memory-context-priority/3' as const;

export interface MemoryPriorityInput {
  id: string;
  contentHash: string;
  title: string;
  chapterTitle?: string;
  sectionTitle?: string;
  summary: string;
}

export interface MemoryPriorityRequest {
  providerId: AssistantProviderId;
  model: string;
  goal: string;
  items: MemoryPriorityInput[];
}

export interface MemoryPriorityAssessment {
  id: string;
  contentHash: string;
  score: number;
  rank: number;
  populationSize: number;
  reason: string;
  goal: string;
  providerId: AssistantProviderId;
  model: string;
  rubricVersion: typeof MEMORY_PRIORITY_RUBRIC_VERSION;
  scoredAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export async function assessMemoryPriority(
  request: MemoryPriorityRequest,
  { signal }: { signal?: AbortSignal } = {},
): Promise<{ items: MemoryPriorityAssessment[] }> {
  if (signal?.aborted) throw new DOMException('已取消评分', 'AbortError');
  if (IS_DEMO_MODE) throw new Error(DEMO_AI_NOTICE);
  // Serialize bounded context fields, even if a caller holds a full content object.
  const contextRequest = {
    providerId: request.providerId, model: request.model, goal: request.goal,
    items: request.items.map(({ id, contentHash, title, chapterTitle, sectionTitle, summary }) => ({ id, contentHash, title, chapterTitle, sectionTitle, summary })),
  };
  const response = await fetch('/api/assistant/memory-priority', {
    method: 'POST', credentials: 'same-origin', signal,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(contextRequest),
  });
  let payload: unknown;
  try { payload = await response.json(); } catch (error) {
    if (signal?.aborted) throw new DOMException('已取消评分', 'AbortError');
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error('评分服务未返回有效数据，请重试。');
  }
  if (signal?.aborted) throw new DOMException('已取消评分', 'AbortError');
  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === 'string'
      ? payload.error.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300)
      : '';
    throw new Error(message || `评分请求失败（${response.status}），请检查助手设置。`);
  }
  const fail = () => { throw new Error('评分结果与请求内容不匹配，未保存任何评分。'); };
  if (!isRecord(payload) || !Array.isArray(payload.items) || payload.items.length !== request.items.length) return fail();
  const expected = new Map(request.items.map(item => [item.id, item]));
  if (expected.size !== request.items.length) return fail();
  const seen = new Set<string>();
  const ranks = new Set<number>();
  const items = payload.items.map(value => {
    if (!isRecord(value) || typeof value.id !== 'string' || !expected.has(value.id) || seen.has(value.id)) return fail();
    seen.add(value.id);
    if (value.contentHash !== expected.get(value.id)!.contentHash || value.goal !== request.goal.trim()
      || value.providerId !== request.providerId || value.model !== request.model || value.rubricVersion !== MEMORY_PRIORITY_RUBRIC_VERSION
      || typeof value.score !== 'number' || !Number.isFinite(value.score) || value.score < 0 || value.score > 1
      || typeof value.rank !== 'number' || !Number.isInteger(value.rank) || value.rank < 1 || value.rank > request.items.length || ranks.has(value.rank)
      || value.populationSize !== request.items.length
      || typeof value.reason !== 'string' || !value.reason.trim() || value.reason.length > 240 || /[\u0000-\u001f\u007f]/.test(value.reason)
      || typeof value.scoredAt !== 'number' || !Number.isFinite(value.scoredAt) || value.scoredAt <= 0) return fail();
    const relativeScore = request.items.length === 1 ? 0.5
      : Math.round((0.15 + 0.85 * (1 - (value.rank - 1) / (request.items.length - 1)) ** 1.4) * 1000) / 1000;
    if (value.score !== relativeScore) return fail();
    ranks.add(value.rank);
    return {
      id: value.id, contentHash: value.contentHash, goal: value.goal, providerId: value.providerId,
      model: value.model, rubricVersion: MEMORY_PRIORITY_RUBRIC_VERSION,
      score: value.score, rank: value.rank, populationSize: value.populationSize,
      reason: value.reason.trim(), scoredAt: value.scoredAt,
    } as MemoryPriorityAssessment;
  });
  return { items: request.items.map(item => items.find(value => value.id === item.id)!) };
}
