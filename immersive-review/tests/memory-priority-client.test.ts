import { setLanguage } from '../src/i18n';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { assessMemoryPriority, type MemoryPriorityRequest } from '../src/notebook/memory-priority-client';

const request: MemoryPriorityRequest = { providerId: 'glm', model: 'test-model', goal: ' 基础 ', items: [{ id: 'note:1', contentHash: 'content-v1', title: '异步', chapterTitle: '编程基础', sectionTitle: '异步机制', summary: '任务与事件循环的执行顺序。' }] };
const valid = { id: 'note:1', contentHash: 'content-v1', score: 0.5, rank: 1, populationSize: 1, reason: '缺少其他内容，本次无法相对比较。', providerId: 'glm', model: 'test-model', goal: '基础', rubricVersion: 'memory-context-priority/3', scoredAt: 123456 };
afterEach(() => vi.unstubAllGlobals());

beforeEach(() => setLanguage('zh-CN'));

describe('memory priority client', () => {
  it('forwards only the request, uses same-origin credentials, and validates complete assessment identity', async () => {
    const mocked = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [valid] }), { status: 200 }));
    vi.stubGlobal('fetch', mocked);
    const controller = new AbortController();
    expect(await assessMemoryPriority(request, { signal: controller.signal })).toEqual({ items: [valid] });
    expect(mocked).toHaveBeenCalledWith('/api/assistant/memory-priority', expect.objectContaining({ method: 'POST', credentials: 'same-origin', signal: controller.signal }));
    expect(JSON.parse(mocked.mock.calls[0][1].body)).toEqual({ ...request, language: 'zh-CN' });
  });

  it.each([
    { id: 'wrong' }, { contentHash: 'content-v2' }, { model: 'wrong' }, { providerId: 'deepseek' },
    { goal: 'another' }, { rubricVersion: 'memory-priority/1' }, { score: 2 }, { score: '0.5' }, { score: 0.7 },
    { rank: 0 }, { rank: 2 }, { rank: 1.1 }, { rank: '1' }, { populationSize: 2 },
    { reason: '' }, { reason: 'x'.repeat(241) }, { scoredAt: -1 },
  ])('rejects mismatched or malformed assessment %j', async override => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [{ ...valid, ...override }] }))));
    await expect(assessMemoryPriority(request)).rejects.toThrow('未保存任何评分');
  });

  it('never forwards body text, excerpts, or other metadata held by a caller', async () => {
    setLanguage('en');
    const mocked = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [valid] })));
    vi.stubGlobal('fetch', mocked);
    const richInput = { ...request, secret: 'unrelated context', items: [{ ...request.items[0], markdown: 'private body', excerpt: 'private excerpt', tags: ['private'] }] };
    await assessMemoryPriority(richInput);
    const forwarded = JSON.parse(mocked.mock.calls[0][1].body);
    expect(forwarded).toEqual({ ...request, language: 'en' });
    expect(JSON.stringify(forwarded)).not.toContain('private');
  });

  it('validates the rank-to-score mapping and full rank permutation across a multi-title batch', async () => {
    const two = { ...request, items: [...request.items, { ...request.items[0], id: 'note:2' }] };
    const first = { ...valid, populationSize: 2, score: 1 };
    const second = { ...valid, id: 'note:2', populationSize: 2, rank: 2, score: 0.15 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [second, first] }))));
    expect((await assessMemoryPriority(two)).items).toEqual([first, second]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [first, { ...second, rank: 1, score: 1 }] }))));
    await expect(assessMemoryPriority(two)).rejects.toThrow('未保存任何评分');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [first, { ...second, score: 0.65 }] }))));
    await expect(assessMemoryPriority(two)).rejects.toThrow('未保存任何评分');
  });

  it('rejects missing and duplicate IDs without returning partial successful results', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] }))));
    await expect(assessMemoryPriority(request)).rejects.toThrow('未保存任何评分');
    const two = { ...request, items: [...request.items, { ...request.items[0], id: 'note:2' }] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [valid, valid] }))));
    await expect(assessMemoryPriority(two)).rejects.toThrow('未保存任何评分');
  });

  it('shows bounded API errors and rejects malformed responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: '内容超限' }), { status: 413 })));
    await expect(assessMemoryPriority(request)).rejects.toThrow('内容超限');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>upstream</html>', { status: 502 })));
    await expect(assessMemoryPriority(request)).rejects.toThrow('未返回有效数据');
  });

  it('does not issue an already-cancelled request and does not accept a response after cancellation', async () => {
    const controller = new AbortController(); controller.abort();
    const mocked = vi.fn(); vi.stubGlobal('fetch', mocked);
    await expect(assessMemoryPriority(request, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocked).not.toHaveBeenCalled();
    const second = new AbortController();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => { second.abort(); return { items: [valid] }; } }));
    await expect(assessMemoryPriority(request, { signal: second.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
