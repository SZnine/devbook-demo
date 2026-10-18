import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  archiveMemo, enroll, loadBusiness, projection, recordRead, removeMemory, restoreMemo, saveDraft, saveMemo,
} from '../src/manual-demo/business-store';
import { enrollMemory, readMemoryState } from '../src/memory/memory-store.mjs';

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });

describe('manual memory and memo persistence', () => {
  it('does not invent a read on enrollment, and preserves explicit reads across removal and reenrollment', async () => {
    const entry = await enroll('py01');
    expect(entry.documentId).toBe('read-manual:hefei-ai-study');
    expect(entry.events).toEqual([]);
    expect(projection(entry, 'py01', { retentionScale: 1 }, Date.now()).retention).toBeNull();
    const read = await recordRead('py01');
    expect(read.events).toHaveLength(1);
    const first = projection(read, 'py01', { retentionScale: 1 }, read.events[0].at);
    expect(first.readCount).toBe(1);
    expect(first.retention).toBe(1);
    expect(projection(read, 'py01', { retentionScale: 1 }, read.events[0].at + 3_600_000).retention).toBeCloseTo(.7427, 4);
    expect((await removeMemory('py01')).active).toBe(false);
    await expect(recordRead('py01')).rejects.toThrow('纳入记忆库');
    const restored = await enroll('py01');
    expect(restored.events).toEqual(read.events);
    expect(restored.addedAt).toBe(entry.addedAt);
  });

  it('isolates sections and leaves historical exercise membership untouched', async () => {
    const old = await enrollMemory({ documentId: 'hefei-ai-study', sectionId: 'py01', documentTitle: '旧演练', title: '旧记录',
      contentHash: `sha256:${'a'.repeat(64)}`, documentRevision: `sha256:${'b'.repeat(64)}`, sectionVersion: 1 });
    await enroll('py01');
    await enroll('py02');
    const read = await recordRead('py01');
    const state = await loadBusiness();
    expect(state.entries).toHaveLength(2);
    expect(state.entries.find(entry => entry.sectionId === 'py02')!.events).toEqual([]);
    expect(projection(read, 'py02', state.settings, Date.now()).readCount).toBe(0);
    expect((await readMemoryState()).entries.find(entry => entry.id === old.id)).toEqual(old);
    await expect(enroll('missing')).rejects.toThrow('不存在');
  });

  it('stores original Markdown, edits in place, and archives/restores without losing content', async () => {
    const markdown = '  ## 我的理解\n\n- [ ] 验证假设\n\n```py\nprint(1)\n```\n';
    const original = await saveMemo({ sectionId: 'py01', markdown }, 1000);
    expect(original.markdown).toBe(markdown);
    const edited = await saveMemo({ id: original.id, sectionId: 'py01', markdown: '**更新**\n' }, 2000);
    expect(edited.id).toBe(original.id);
    expect(edited.createdAt).toBe(1000);
    expect(edited.updatedAt).toBe(2000);
    const archived = await archiveMemo(original.id);
    expect(archived.archivedAt).toBeTypeOf('number');
    await expect(saveMemo({ id: original.id, sectionId: 'py01', markdown: '更改' })).rejects.toThrow('恢复');
    const restored = await restoreMemo(original.id);
    expect(restored.archivedAt).toBeUndefined();
    expect(restored.markdown).toBe(edited.markdown);
    expect(restored.createdAt).toBe(1000);
    await expect(saveMemo({ id: original.id, sectionId: 'py02', markdown: '跨节' })).rejects.toThrow('另一节');
  });

  it('keeps drafts across reloads, rejects blank memos, and clears only the saved section draft atomically', async () => {
    await saveDraft({ sectionId: 'py01', markdown: '未完成的随笔' });
    await saveDraft({ sectionId: 'py02', markdown: '另一节的草稿' });
    await expect(saveMemo({ sectionId: 'py01', markdown: ' \n ' })).rejects.toThrow('内容');
    expect((await loadBusiness()).drafts.find(draft => draft.sectionId === 'py01')?.markdown).toBe('未完成的随笔');
    const memo = await saveMemo({ sectionId: 'py01', markdown: '保存正文' });
    let state = await loadBusiness();
    expect(state.memos).toEqual([memo]);
    expect(state.drafts).toEqual([{ sectionId: 'py02', markdown: '另一节的草稿' }]);
    await saveDraft({ sectionId: 'py01', markdown: '编辑草稿', editingId: memo.id });
    state = await loadBusiness();
    expect(state.drafts.find(draft => draft.sectionId === 'py01')?.editingId).toBe(memo.id);
    await saveDraft({ sectionId: 'py02', markdown: ' \n ' });
    expect((await loadBusiness()).drafts).toHaveLength(1);
    await expect(saveDraft({ sectionId: 'py02', markdown: '跨节编辑', editingId: memo.id })).rejects.toThrow('不能编辑');
  });

  it('serializes overlapping draft/save writes and recovers after a failed operation', async () => {
    const draft = saveDraft({ sectionId: 'py01', markdown: '保存前草稿' });
    const save = saveMemo({ sectionId: 'py01', markdown: '最后确认的正文' }, 3000);
    const memo = await save;
    await draft;
    expect((await loadBusiness()).drafts).toEqual([]);
    await expect(saveMemo({ sectionId: 'missing', markdown: '错误' })).rejects.toThrow('不存在');
    await saveDraft({ sectionId: 'py01', markdown: '下一条草稿' });
    const fresh = await loadBusiness();
    expect(fresh.memos).toEqual([memo]);
    expect(fresh.drafts).toEqual([{ sectionId: 'py01', markdown: '下一条草稿' }]);
  });

  it('does not change the memory content identity when a memo is added or edited', async () => {
    await enroll('py01');
    const read = await recordRead('py01');
    const before = projection(read, 'py01', { retentionScale: 1 }, read.events[0].at);
    const memo = await saveMemo({ sectionId: 'py01', markdown: '个人理解' });
    await saveMemo({ id: memo.id, sectionId: 'py01', markdown: '新的个人理解' });
    const loaded = (await loadBusiness()).entries[0];
    expect(projection(loaded, 'py01', { retentionScale: 1 }, read.events[0].at)).toEqual(before);
    expect((await loadBusiness()).settings.retentionScale).toBe(1);
  });
});
