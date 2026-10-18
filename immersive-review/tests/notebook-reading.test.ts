import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import * as notebook from '../src/notebook/store';
import { recordManualRead } from '../src/memory/memory-store.mjs';
import type { MemoryPriorityAssessment } from '../src/notebook/memory-priority-client';

const T = Date.UTC(2026, 9, 17, 4);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });

async function savedNote(markdown = '异步操作通过 Promise 表示未来的结果。', enroll = false) {
  const note = await notebook.saveNote({ markdown }, T);
  const ref: notebook.Ref = { kind: 'note', id: note.id };
  if (enroll) await notebook.enrollRef(ref);
  const state = await notebook.loadNotebook();
  return { ref, note, identity: notebook.readingReference(ref, state) };
}
function focus(sessionId: string, contentHash?: string) {
  return { source: 'focus' as const, sessionId, activeMs: 90_000, coverage: 1, contentHash };
}
async function readNote(markdown?: string) {
  const saved = await savedNote(markdown);
  await notebook.recordRef(saved.ref, focus('initial-reading', saved.identity.contentHash), T);
  return saved;
}
async function assessment(ref: notebook.Ref, rank = 1, populationSize = 1): Promise<MemoryPriorityAssessment> {
  const state = await notebook.loadNotebook();
  const score = populationSize === 1 ? 0.5 : Math.round((0.15 + 0.85 * (1 - (rank - 1) / (populationSize - 1)) ** 1.4) * 1000) / 1000;
  return { id: `${ref.kind}:${ref.id}`, contentHash: notebook.readingReference(ref, state).contentHash, score, rank, populationSize,
    reason: '可复用的编程基础。', goal: '掌握异步编程', providerId: 'glm', model: 'configured-model',
    rubricVersion: 'memory-context-priority/3', scoredAt: T };
}

describe('notebook reading integration', () => {
  it('retains legacy manual facts exactly while deriving de-duplicated episodes and adding new focus evidence', async () => {
    const { ref, identity } = await savedNote(undefined, true);
    await recordManualRead(identity, T);
    const legacy = await recordManualRead(identity, T + MINUTE);
    const originalEvents = structuredClone(legacy.events);
    const before = await notebook.loadNotebook();
    const projection = notebook.getProjection(ref, before, T + 2 * MINUTE);
    expect(projection.totalReadCount).toBe(2);
    expect(projection.episodes).toBe(1);
    expect(projection.history.map(event => event.source)).toEqual(['legacy-manual', 'legacy-manual']);
    expect(before.entries[0].events).toEqual(originalEvents);
    expect(before.entries[0].events.every(event => event.source === undefined)).toBe(true);

    const automatic = await notebook.recordRef(ref, focus('later-reading', identity.contentHash), T + HOUR);
    expect(automatic.recorded).toBe(true);
    const reloaded = await notebook.loadNotebook();
    expect(reloaded.entries[0].events.slice(0, 2)).toEqual(originalEvents);
    expect(reloaded.entries[0].events[2]).toMatchObject({ source: 'focus', sessionId: 'later-reading', activeMs: 90_000, coverage: 1 });
    expect(notebook.getProjection(ref, reloaded, T + HOUR)).toMatchObject({ totalReadCount: 3, episodes: 2, strengthDays: 1 });
  });

  it('serializes simultaneous automatic and manual recording without inflating counts or advancing the first timestamp', async () => {
    const { ref, identity } = await savedNote();
    const results = await Promise.all([
      notebook.recordRef(ref, focus('focus-tab', identity.contentHash), T),
      notebook.recordRef(ref, { source: 'manual', sessionId: 'manual-click' }, T + 1),
      notebook.recordRef(ref, focus('other-tab', identity.contentHash), T + 2),
    ]);
    expect(results.map(result => result.recorded)).toEqual([true, false, false]);
    const state = await notebook.loadNotebook();
    expect(state.entries[0].events).toHaveLength(1);
    expect(state.entries[0].events[0].at).toBe(T);
    expect(notebook.getProjection(ref, state, T + MINUTE).episodes).toBe(1);
    const repeated = await notebook.recordRef(ref, focus('focus-tab', identity.contentHash), T + 2 * HOUR);
    expect(repeated.recorded).toBe(false);
    expect(repeated.entry.events).toHaveLength(1);
  });

  it('does not create an entry for insufficient reading, auto-creates on valid focus, and keeps legacy readRef return compatibility', async () => {
    const note = await notebook.saveNote({ markdown: '字'.repeat(2000) }, T);
    const ref: notebook.Ref = { kind: 'note', id: note.id };
    await expect(notebook.recordRef(ref, { source: 'manual', sessionId: 'un-enrolled' }, T)).rejects.toThrow('纳入记忆库');
    await expect(notebook.recordRef(ref, { ...focus('too-short'), activeMs: 20_000 }, T)).rejects.toThrow('时间不足');
    await expect(notebook.recordRef(ref, { ...focus('too-narrow'), coverage: 0.5 }, T)).rejects.toThrow('覆盖不足');
    expect((await notebook.loadNotebook()).entries).toHaveLength(0);
    const first = await notebook.recordRef(ref, focus('first-valid-reading'), T);
    expect(first.recorded).toBe(true);
    expect(first.entry.active).toBe(true);
    expect(first.entry.events).toHaveLength(1);
    const compatible = await notebook.readRef(ref, T + HOUR);
    expect(compatible.events).toHaveLength(2);
    expect(compatible.events[0]).toEqual(first.entry.events[0]);
    expect(compatible).not.toHaveProperty('recorded');
    await notebook.archiveNote(note.id);
    await expect(notebook.recordRef(ref, focus('archived'), T + HOUR)).rejects.toThrow('恢复');
    expect((await notebook.loadNotebook()).entries[0].events).toEqual(compatible.events);
  });

  it('does not recreate an explicitly paused entry, and resuming retains all old reading facts', async () => {
    const { ref, identity } = await savedNote();
    const first = await notebook.recordRef(ref, focus('first', identity.contentHash), T);
    await notebook.removeRef(ref);
    const paused = await notebook.loadNotebook();
    expect(paused.entries[0]).toMatchObject({ active: false, trackingPaused: true });
    expect(paused.entries[0].events).toEqual(first.entry.events);
    const background = await notebook.recordRef(ref, focus('background', identity.contentHash), T + HOUR);
    expect(background.recorded).toBe(false);
    expect(background.entry).toEqual(paused.entries[0]);
    await expect(notebook.readRef(ref, T + HOUR)).rejects.toThrow('纳入记忆库');
    await notebook.enrollRef(ref);
    const resumed = await notebook.recordRef(ref, focus('resumed', identity.contentHash), T + 2 * HOUR);
    expect(resumed.recorded).toBe(true);
    expect(resumed.entry.events).toHaveLength(2);
    expect(resumed.entry.events[0]).toEqual(first.entry.events[0]);
  });

  it('rejects stale focus snapshots after an edit while retaining old history and requiring fresh evidence for the new version', async () => {
    const { ref, note, identity } = await savedNote();
    const first = await notebook.recordRef(ref, focus('before-edit', identity.contentHash), T);
    await notebook.saveNote({ id: note.id, markdown: '事件循环由任务队列和微任务队列共同协调。' }, T + MINUTE);
    await expect(notebook.recordRef(ref, focus('stale-browser', identity.contentHash), T + 2 * MINUTE)).rejects.toThrow('内容已变更');
    let state = await notebook.loadNotebook();
    expect(state.entries[0].events).toEqual(first.entry.events);
    expect(notebook.getProjection(ref, state, T + 2 * MINUTE)).toMatchObject({ freshness: null, versionChanged: true, totalReadCount: 1 });
    const current = notebook.readingReference(ref, state);
    const updated = await notebook.recordRef(ref, focus('after-edit', current.contentHash), T + 3 * MINUTE);
    expect(updated.recorded).toBe(true);
    state = await notebook.loadNotebook();
    expect(state.entries[0].events).toHaveLength(2);
    expect(notebook.getProjection(ref, state, T + 3 * MINUTE)).toMatchObject({ freshness: 1, totalReadCount: 2, episodes: 1 });
  });

  it('lets a manual priority override later AI results and restores AI/default priorities only when the user clears that override', async () => {
    const { ref, note } = await readNote();
    await notebook.setRefPriority(ref, 0.2);
    await notebook.applyAiPriorities([await assessment(ref)]);
    let state = await notebook.loadNotebook();
    expect(notebook.getProjection(ref, state, T)).toMatchObject({ priority: 0.2, prioritySource: 'manual' });
    expect(state.entries[0].priority?.ai).toMatchObject({ score: 0.5, rank: 1, populationSize: 1, rubricVersion: 'memory-context-priority/3' });
    await notebook.setRefPriority(ref, undefined);
    state = await notebook.loadNotebook();
    expect(notebook.getProjection(ref, state, T)).toMatchObject({ priority: 0.5, prioritySource: 'ai' });
    await notebook.saveNote({ id: note.id, markdown: '内容改为网络通信基础。' }, T + MINUTE);
    state = await notebook.loadNotebook();
    expect(notebook.getProjection(ref, state, T + MINUTE)).toMatchObject({ priority: 0.5, prioritySource: 'default' });
    expect(state.entries[0].priority?.ai?.score).toBe(0.5);
  });

  it('rejects a stale AI batch before saving any item', async () => {
    const one = await readNote();
    const two = await readNote('另一节有关 Promise 的内容。');
    const results = [await assessment(one.ref, 1, 2), await assessment(two.ref, 2, 2)];
    await notebook.saveNote({ id: two.note.id, markdown: '评分期间内容改写。' }, T + MINUTE);
    await expect(notebook.applyAiPriorities(results)).rejects.toThrow('内容已变更');
    const state = await notebook.loadNotebook();
    expect(state.entries.every(entry => entry.priority?.ai === undefined)).toBe(true);
  });

  it('does not partially save an AI batch when an item was removed from memory while the model was scoring', async () => {
    const one = await readNote();
    const two = await readNote('第二节的内容。');
    const results = [await assessment(one.ref, 1, 2), await assessment(two.ref, 2, 2)];
    await notebook.removeRef(two.ref);
    await expect(notebook.applyAiPriorities(results)).rejects.toThrow('已移出记忆库');
    expect((await notebook.loadNotebook()).entries.every(entry => entry.priority?.ai === undefined)).toBe(true);
  });

  it('stores a distinct relative comparison without modifying reading history or the forgetting factor', async () => {
    const one = await readNote();
    const two = await readNote('补充说明：另一个低相关主题。');
    const before = await notebook.loadNotebook();
    const results = [await assessment(one.ref, 1, 2), await assessment(two.ref, 2, 2)];
    expect(results.map(item => item.score)).toEqual([1, 0.15]);
    await notebook.applyAiPriorities(results);
    const after = await notebook.loadNotebook();
    expect(after.entries.map(item => item.events)).toEqual(before.entries.map(item => item.events));
    const high = notebook.getProjection(one.ref, after, T + 6 * HOUR);
    const low = notebook.getProjection(two.ref, after, T + 6 * HOUR);
    expect(high.forgettingFactor).toBeCloseTo(0.5);
    expect(low.forgettingFactor).toBe(high.forgettingFactor);
    expect(high.recommendation).toBeCloseTo(0.5);
    expect(low.recommendation).toBeCloseTo(0.075);
  });

  it('preserves a cancelled event and never automatically reinstates it when the same session retries after reload', async () => {
    const { ref, identity } = await savedNote();
    const recorded = await notebook.recordRef(ref, focus('reading-session', identity.contentHash), T);
    const eventId = recorded.entry.events[0].id;
    await notebook.undoRef(ref, eventId);
    const reloaded = await notebook.loadNotebook();
    expect(reloaded.entries[0].events[0].voidedAt).toBeTypeOf('number');
    expect(notebook.getProjection(ref, reloaded, T + HOUR)).toMatchObject({ freshness: null, episodes: 0, totalReadCount: 0 });
    const retried = await notebook.recordRef(ref, focus('reading-session', identity.contentHash), T + HOUR);
    expect(retried.recorded).toBe(false);
    expect(retried.entry.events).toEqual(reloaded.entries[0].events);
    const deliberateNewRead = await notebook.recordRef(ref, { source: 'manual', sessionId: 'user-explicit-new-read' }, T + 2 * HOUR);
    expect(deliberateNewRead.recorded).toBe(true);
  });
});
