import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createDemoContent } from '../src/notebook/demo-content';
import { setLanguage } from '../src/i18n';
import * as store from '../src/notebook/store';
import * as legacy from '../src/manual-demo/business-store';
import { createSearchIndex } from '../src/notebook/global-search';

const mode = vi.hoisted(() => ({ demo: true }));
vi.mock('../src/demo', () => ({ get IS_DEMO_MODE() { return mode.demo; } }));

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); mode.demo = true; setLanguage('en'); });

describe('English public sample workspace', () => {
  it('uses distinct everyday scenarios, valid hierarchy, and no assistant subject matter', () => {
    const content = createDemoContent(1_000_000_000);
    expect(content.notes.filter(note => note.kind === 'memo')).toHaveLength(6);
    expect(content.notes.filter(note => note.kind === 'document')).toHaveLength(8);
    expect(content.collections).toHaveLength(9);
    const noteIds = new Set(content.notes.map(note => note.id));
    const collectionIds = new Set(content.collections.map(collection => collection.id));
    for (const collection of content.collections) for (const ref of collection.items) {
      expect((ref.kind === 'chapter' ? collectionIds : noteIds).has(ref.id)).toBe(true);
    }
    const text = JSON.stringify(content);
    expect(text).not.toMatch(/[\p{Script=Han}]/u);
    expect(text).not.toMatch(/\b(?:AI|LLM|GPT|ChatGPT|DeepSeek|GLM|assistant|agent)\b/i);
    expect(text).toContain('```sh');
    expect(text).toContain('- [ ]');
    expect(text).toContain('Coffee Notebook');
    expect(text).toContain('A Weekend in Kyoto');
    expect(text).toContain('Web Field Notes');
  });

  it('leaves a new local deployment empty', async () => {
    mode.demo = false;
    const state = await store.loadNotebook();
    expect(state.notes).toEqual([]);
    expect(state.collections).toEqual([]);
  });

  it('seeds an unused demo exactly once even during simultaneous initial reads', async () => {
    const [first, second] = await Promise.all([store.loadNotebook(), store.loadNotebook()]);
    expect(first.notes).toHaveLength(14);
    expect(first.collections).toHaveLength(9);
    expect(first.entries).toEqual([]);
    expect(second).toEqual(first);
    await store.saveNote({ id: first.notes[0].id, markdown: 'My edit' });
    expect((await store.loadNotebook()).notes.find(note => note.id === first.notes[0].id)?.markdown).toBe('My edit');
  });

  it('never adds examples to an existing note, archive, draft, or migrated workspace', async () => {
    const note = await store.saveNote({ markdown: 'A private note' });
    await store.archiveNote(note.id);
    expect((await store.loadNotebook()).notes.map(item => item.id)).toEqual([note.id]);
    expect((await store.loadNotebook()).collections).toEqual([]);

    globalThis.indexedDB = new IDBFactory();
    await store.saveDraft({ markdown: 'An unfinished sentence' });
    expect((await store.loadNotebook()).notes).toEqual([]);
    expect((await store.loadNotebook()).draft.markdown).toBe('An unfinished sentence');

    globalThis.indexedDB = new IDBFactory();
    const prior = await legacy.saveMemo({ sectionId: 'py01', markdown: 'An existing reference note' });
    expect((await store.loadNotebook()).notes.map(item => item.id)).toEqual([prior.id]);
    expect((await store.loadNotebook()).collections).toEqual([]);
  });

  it('preserves an empty deleted book and pre-existing reference learning history', async () => {
    const book = await store.createCollection('My empty book');
    await store.trashCollection(book.id);
    const deleted = await store.loadNotebook();
    expect(deleted.collections.map(item => item.id)).toEqual([book.id]);
    expect(deleted.notes).toEqual([]);

    globalThis.indexedDB = new IDBFactory();
    const entry = await legacy.enroll('py01');
    const prior = await store.loadNotebook();
    expect(prior.entries.map(item => item.id)).toEqual([entry.id]);
    expect(prior.notes).toEqual([]);
    expect(prior.collections).toEqual([]);
  });

  it('does not reinsert samples after a user clears the demo workspace', async () => {
    await store.loadNotebook();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(store.NOTEBOOK_DB, 1);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('workspace', 'readwrite');
        tx.objectStore('workspace').put({ notes: [], collections: [], draft: { markdown: '' }, legacyDrafts: [] }, 'root');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
      request.onerror = () => reject(request.error);
    });
    const state = await store.loadNotebook();
    expect(state.notes).toEqual([]);
    expect(state.collections).toEqual([]);
  });

  it('keeps the legacy training manual out of public demo search', async () => {
    const index = createSearchIndex(await store.loadNotebook());
    expect(index.length).toBeGreaterThan(20);
    expect(index.some(item => item.target.kind === 'manual')).toBe(false);
    expect(JSON.stringify(index)).not.toMatch(/[\p{Script=Han}]/u);
  });
});
