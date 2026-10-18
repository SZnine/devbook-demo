import { describe, expect, it } from 'vitest';
import { createSearchIndex, highlightMatches, searchKeywordIndex, type GlobalSearchState } from '../src/notebook/global-search';
import core from '../src/manual-demo/research/core.json';

const catalog = { title: '参考训练手册', topics: [{ id: 'python', title: 'Python 基础', sectionIds: ['p1'] }],
  sections: [{ id: 'p1', title: '列表与切片', parts: [{ markdown: '```python\nitems.reverse()\n```\n\n| 方法 | 说明 |\n| reverse | 原地反转 |' }] }] };
const state = (): GlobalSearchState => ({ collections: [
  { id: 'book', title: '工程实践', items: [{ kind: 'chapter', id: 'chapter' }] },
  { id: 'chapter', title: '可靠性', summary: '网络故障的恢复策略', items: [{ kind: 'note', id: 'doc' }] },
], notes: [{ id: 'doc', kind: 'document', markdown: '## 安全重试\n\n### 幂等键\n\nHTTP 超时后采用 Backoff。', createdAt: 1, updatedAt: 1 }] });

describe('global keyword search', () => {
  it('searches across parent titles, child headings and complete body without page state', () => {
    const results = searchKeywordIndex(createSearchIndex(state(), catalog), '工程实践 幂等键 backoff');
    expect(results).toHaveLength(1);
    expect(results[0].target).toEqual({ kind: 'collection', collectionId: 'chapter', ref: { kind: 'note', id: 'doc' } });
    expect(results[0].path).toEqual(['工程实践', '可靠性']);
    expect(results[0].snippet).toContain('HTTP');
    expect(searchKeywordIndex(createSearchIndex(state(), catalog), 'backoff 不存在')).toHaveLength(0);
  });
  it('searches book and chapter summaries and respects aliases', () => {
    const data = state();
    data.collections[1].titles = { 'note:doc': '连接重建' };
    expect(searchKeywordIndex(createSearchIndex(data, catalog), '故障 恢复')[0].target).toEqual({ kind: 'collection', collectionId: 'chapter', summary: true });
    expect(searchKeywordIndex(createSearchIndex(data, catalog), '连接重建')[0].title).toBe('连接重建');
  });
  it('prioritizes titles and matches code or table content in all reference chapters', () => {
    const data = state();
    data.notes.push({ id: 'memo', markdown: 'reverse 的理解', createdAt: 1, updatedAt: 1 });
    const results = searchKeywordIndex(createSearchIndex(data, catalog), 'reverse');
    expect(results[0].target).toEqual({ kind: 'memo', memoId: 'memo' });
    expect(results.some(item => item.target.kind === 'manual' && item.target.sectionId === 'p1')).toBe(true);
    expect(searchKeywordIndex(createSearchIndex(data, catalog), 'Python 原地反转')[0].target).toEqual({ kind: 'manual', topicId: 'python', sectionId: 'p1' });
  });
  it('searches saved memo quotes independently of their original book', () => {
    const data = state();
    data.notes.push({ id: 'memo', markdown: '我的理解', createdAt: 1, updatedAt: 1, source: { kind: 'content', collectionId: 'chapter', ref: { kind: 'note', id: 'doc' }, title: '重试', path: ['旧书'], quote: 'print("引用独有关键词")', capturedAt: 1 } });
    const results = searchKeywordIndex(createSearchIndex(data, catalog), '引用独有关键词');
    expect(results).toHaveLength(1);
    expect(results[0].target).toEqual({ kind: 'memo', memoId: 'memo' });
  });
  it('excludes archived and deleted books, their descendants, archived memos and unattached documents', () => {
    const data = state();
    data.collections[0].archivedAt = 1;
    data.notes.push({ id: 'memo', markdown: '秘密', archivedAt: 1, createdAt: 1, updatedAt: 1 }, { id: 'orphan', markdown: '秘密', kind: 'document', createdAt: 1, updatedAt: 1 });
    expect(createSearchIndex(data, catalog).every(item => item.target.kind === 'manual')).toBe(true);
    delete data.collections[0].archivedAt;
    data.collections[0].deletedAt = 2;
    expect(createSearchIndex(data, catalog).every(item => item.target.kind === 'manual')).toBe(true);
  });
  it('searches real curated additions as part of reference content', () => {
    const index = createSearchIndex({ notes: [], collections: [] });
    const review = core.reviews.find(item => item.additions.length > 0)!;
    expect(index.find(item => item.target.kind === 'manual' && item.target.sectionId === review.sectionId)?.body).toContain(review.additions[0].body);
    expect(searchKeywordIndex(index, 'Python')).not.toHaveLength(0);
  });
  it('handles empty queries and treats regex symbols as ordinary keywords', () => {
    const index = createSearchIndex(state(), catalog);
    expect(searchKeywordIndex(index, '  ')).toEqual([]);
    expect(searchKeywordIndex(index, 'items.reverse()')[0].target.kind).toBe('manual');
    expect(searchKeywordIndex(index, '[.*')).toEqual([]);
  });
  it('keeps code identifiers intact in the result excerpt', () => {
    const data = state();
    data.notes[0].markdown = '```python\nmax_tokens = 1024\n```';
    const result = searchKeywordIndex(createSearchIndex(data, catalog), 'max_tokens')[0];
    expect(result.snippet).toContain('max_tokens');
    expect(highlightMatches(result.snippet, 'max_tokens').some(run => run.match)).toBe(true);
  });
  it('builds escaped text runs and merges overlapping highlights', () => {
    const input = '<script>alert(1)</script> backoff';
    const runs = highlightMatches(input, '<script> back backoff');
    expect(runs.map(run => run.text).join('')).toBe(input);
    expect(runs.filter(run => run.match).map(run => run.text)).toEqual(['<script>', 'backoff']);
  });
});
