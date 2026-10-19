import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { dataCopy, exportFilename, markdownExport } from '../src/notebook/file-exports';
import { loadExportDirectory, saveExportDirectory, writeExport, type ExportDirectory } from '../src/notebook/export-directory';
import { ASSISTANT_HISTORY_KEY } from '../src/notebook/assistant-history';
import * as store from '../src/notebook/store';

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });

describe('portable content exports', () => {
  it('keeps complete current workspace state and conversation history without copying unrelated browser data', async () => {
    const book = await store.createCollection('实验书');
    await store.createNoteInCollection(book.id, '# 实验\n\n```ts\nconst n = 1;\n```');
    await store.saveDraft({ markdown: '未保存的随笔' });
    const state = await store.loadNotebook();
    const local = new Map([[ASSISTANT_HISTORY_KEY, '{"version":2,"conversations":[]}'], ['read-appearance', 'dark'], ['apiKey', 'NEVER_EXPORT_THIS'], ['another-app', 'UNRELATED']]);
    const raw = dataCopy(state, { getItem: key => local.get(key) ?? null }, new Date('2026-10-18T00:00:00Z'));
    const result = JSON.parse(raw);
    expect(result.format).toBe('read-data-copy');
    expect(result.workspace.notes).toEqual(state.notes);
    expect(result.workspace.collections).toEqual(state.collections);
    expect(result.workspace.draft.markdown).toBe('未保存的随笔');
    expect(result.memory.settings).toEqual(state.settings);
    expect(result.assistantHistory.version).toBe(2);
    expect(result.preferences).toEqual({ 'read-appearance': 'dark' });
    expect(raw).not.toMatch(/NEVER_EXPORT_THIS|UNRELATED/);
    expect(exportFilename('json', new Date('2026-10-18T01:02:03Z'))).toBe('read-2026-10-18T01-02-03-000Z.json');
  });

  it('preserves Markdown code, hierarchy, memo quotations and excludes deleted book content', async () => {
    const book = await store.createCollection('实验书');
    await store.createNoteInCollection(book.id, '```ts\nconst n = 1;\n```');
    const chapter = await store.createCollection('子章节', book.id);
    await store.createNoteInCollection(chapter.id, '章节正文');
    const removed = await store.createCollection('删除的书');
    await store.createNoteInCollection(removed.id, '不应出现在Markdown里的已删内容');
    await store.trashCollection(removed.id);
    await store.saveNote({ markdown: '# 随笔\n我的想法' });
    const state = await store.loadNotebook();
    const result = markdownExport(state);
    expect(result).toContain('实验书 / 子章节');
    expect(result).toContain('```ts\nconst n = 1;\n```');
    expect(result).toContain('我的想法');
    expect(result).not.toContain('不应出现在Markdown里的已删内容');
    expect(JSON.parse(dataCopy(state, { getItem: () => null })).workspace.collections.some((item: store.Collection) => item.id === removed.id)).toBe(true);
  });
});

describe('chosen local export directory', () => {
  it('persists the chosen handle slot and clears only that preference', async () => {
    const handle = { kind: 'directory', name: 'My Notes' } as ExportDirectory;
    expect(await loadExportDirectory()).toBe(null);
    await saveExportDirectory(handle);
    expect(await loadExportDirectory()).toEqual(handle);
    await saveExportDirectory(null);
    expect(await loadExportDirectory()).toBe(null);
  });

  function directory(permission: PermissionState, response: PermissionState) {
    const writable = { write: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined), abort: vi.fn().mockResolvedValue(undefined) };
    const handle = { kind: 'directory' as const, name: 'Notes', queryPermission: vi.fn().mockResolvedValue(permission), requestPermission: vi.fn().mockResolvedValue(response), getFileHandle: vi.fn().mockResolvedValue({ createWritable: vi.fn().mockResolvedValue(writable) }) };
    return { handle, writable };
  }

  it('requests fresh write permission after reopening instead of treating a remembered handle as permission', async () => {
    const { handle, writable } = directory('prompt', 'granted');
    const blob = new Blob(['hello']);
    await writeExport(handle, 'read.md', blob);
    expect(handle.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
    expect(handle.getFileHandle).toHaveBeenCalledWith('read.md', { create: true });
    expect(writable.write).toHaveBeenCalledWith(blob);
    expect(writable.close).toHaveBeenCalled();
  });

  it('does not create or overwrite files after denied permission or invalid filenames', async () => {
    const { handle } = directory('prompt', 'denied');
    await expect(writeExport(handle, 'read.json', new Blob(['{}']))).rejects.toThrow('permission');
    await expect(writeExport(handle, '../escape.md', new Blob(['x']))).rejects.toThrow('filename');
    expect(handle.getFileHandle).not.toHaveBeenCalled();
  });

  it('aborts the write when file storage fails', async () => {
    const { handle, writable } = directory('granted', 'denied');
    writable.write.mockRejectedValue(new Error('disk full'));
    await expect(writeExport(handle, 'read.md', new Blob(['x']))).rejects.toThrow('disk full');
    expect(handle.requestPermission).not.toHaveBeenCalled();
    expect(writable.close).not.toHaveBeenCalled();
    expect(writable.abort).toHaveBeenCalled();
  });
});
