import { describe, expect, it } from 'vitest';
import { compactReadingSummary, memoryScoringContext } from '../src/notebook/memory-context';
import { manual } from '../src/notebook/content';
import type { NotebookState } from '../src/notebook/store';

const state = (): NotebookState => ({ notes: [], collections: [], entries: [], deletedContent: [], draft: { markdown: '' }, legacyDrafts: [], settings: { retentionScale: 1 } });

describe('memory scoring context', () => {
  it('includes the chapter and individual section rather than the book title alone', () => {
    const topic = manual.topics[0];
    const context = memoryScoringContext({ kind: 'section', id: topic.sectionIds[0] }, state());
    expect(context.chapterTitle).toBe(topic.title);
    expect(context.sectionTitle).not.toBe(manual.title);
    expect(context.summary.length).toBeGreaterThan(10);
    expect(context.summary.length).toBeLessThanOrEqual(360);
  });

  it('uses the live book/chapter hierarchy and headings plus extracts across a note', () => {
    const data = state();
    data.collections = [{ id: 'book', title: '工程实践', items: [{ kind: 'chapter', id: 'chapter' }] }, { id: 'chapter', title: '可靠性', items: [{ kind: 'note', id: 'n' }] }];
    data.notes = [{ id: 'n', createdAt: 1, updatedAt: 1, markdown: '# 重试\n\n开头说明。\n\n## 幂等\n\n中间是幂等键约束。\n\n## 退避\n\n结尾包含指数退避。' }];
    const context = memoryScoringContext({ kind: 'note', id: 'n' }, data);
    expect(context.chapterTitle).toBe('工程实践 / 可靠性');
    expect(context.sectionTitle).toBe('重试');
    for (const text of ['幂等', '退避', '开头说明', '中间是', '结尾包含']) expect(context.summary).toContain(text);
    data.collections[1].titles = { 'note:n': '在服务端安全重试' };
    expect(memoryScoringContext({ kind: 'note', id: 'n' }, data).sectionTitle).toBe('在服务端安全重试');
  });

  it('bounds long excerpts, removes media URLs, and does not lose code-only notes', () => {
    const summary = compactReadingSummary('## 标题\n\n' + '正文'.repeat(10_000) + '\n\n[说明](https://example.com/private-query)\n\n```js\nsecret();\n```');
    expect(summary.length).toBeLessThanOrEqual(360);
    expect(summary).not.toContain('https://');
    expect(summary).not.toContain('secret();');
    expect(compactReadingSummary('```ts\nconst retries = 3;\n```')).toContain('const retries = 3;');
  });

  it('does not assign an archived collection as the active chapter context', () => {
    const data = state();
    data.notes = [{ id: 'n', markdown: '独立的观察', createdAt: 1, updatedAt: 1 }];
    data.collections = [{ id: 'old', title: '旧书', archivedAt: 1, items: [{ kind: 'note', id: 'n' }] }];
    expect(memoryScoringContext({ kind: 'note', id: 'n' }, data).chapterTitle).toBeUndefined();
    expect(memoryScoringContext({ kind: 'note', id: 'n' }, data).summary).toBe('独立的观察');
  });
});
