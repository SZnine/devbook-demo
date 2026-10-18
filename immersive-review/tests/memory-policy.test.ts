import { describe, expect, it } from 'vitest';
import { createFocusState, dayBucket, estimateSeconds, projectReadingMemory, requiredActiveMs, sampleFocus, type FocusSample } from '../src/notebook/memory-policy';
import type { MemoryEntry, MemoryRead } from '../src/memory/memory-store.mjs';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T = Date.UTC(2026, 9, 17, 4);
const HASH = `sha256:${'a'.repeat(64)}`;
const OTHER = `sha256:${'b'.repeat(64)}`;
const TEXT = '这是一个需要重新熟悉的概念。';
const event = (id: string, at: number, extra: Partial<MemoryRead> = {}): MemoryRead => ({ id, at, contentHash: HASH, documentRevision: HASH, sectionVersion: 1, ...extra });
const entry = (events: MemoryRead[], extra: Partial<MemoryEntry> = {}): MemoryEntry => ({ id: 'entry', documentId: 'book', sectionId: 'note', documentTitle: '书', title: '节', active: true, addedAt: T, events, ...extra });
const project = (events: MemoryRead[], now = T, extra: Partial<MemoryEntry> = {}) => projectReadingMemory(entry(events, extra), HASH, TEXT, undefined, now);
const sample = (extra: Partial<FocusSample> = {}): FocusSample => ({ deltaMs: 1000, visible: true, focused: true, reading: true, engaged: true, idleMs: 0, range: [0, 1], ...extra });
function readFor(seconds: number, target = 30, extra: Partial<FocusSample> = {}) {
  let state = createFocusState();
  for (let i = 0; i < seconds; i++) state = sampleFocus(state, sample(extra), target);
  return state;
}

describe('Reading focus evidence', () => {
  it('estimates mixed writing/code effort and ignores empty Markdown scaffolding', () => {
    expect(estimateSeconds('###\n---\n```js\n```')).toBe(0);
    expect(estimateSeconds('中文 words')).toBe(15);
    expect(estimateSeconds('中文'.repeat(100))).toBe(40);
    expect(estimateSeconds('word '.repeat(120))).toBe(40);
    expect(estimateSeconds('```js\n' + 'const x = 1;\n'.repeat(10) + '```')).toBe(50);
    expect(estimateSeconds('字'.repeat(100_000))).toBe(900);
  });

  it('requires at least twenty seconds and caps the effort threshold at ninety seconds', () => {
    expect(readFor(19, 15).qualified).toBe(false);
    expect(readFor(20, 15).qualified).toBe(true);
    expect(requiredActiveMs(900)).toBe(90_000);
    expect(requiredActiveMs(0)).toBe(Infinity);
  });

  it('never mutates a previous sample and drops evidence for empty replacement content', () => {
    const first = createFocusState();
    const second = sampleFocus(first, sample(), 15);
    expect(first.bands).toEqual(Array(12).fill(0));
    expect(first.activeMs).toBe(0);
    expect(second.bands).not.toBe(first.bands);
    expect(readFor(100, 0).activeMs).toBe(0);
    expect(sampleFocus(readFor(30), sample(), 0).qualified).toBe(false);
  });

  it.each([{ visible: false }, { focused: false }, { reading: false }, { engaged: false }, { idleMs: 90_001 }])('does not count inactive sample %s', extra => {
    expect(readFor(100, 30, extra).activeMs).toBe(0);
  });

  it('drops background/sleep gaps rather than backfilling them', () => {
    for (const deltaMs of [2501, HOUR, -1, 0, NaN, Infinity]) {
      expect(sampleFocus(createFocusState(), sample({ deltaMs }), 30).activeMs).toBe(0);
    }
    expect(sampleFocus(createFocusState(), sample({ deltaMs: 2500 }), 30).activeMs).toBe(2500);
  });

  it('requires coverage across the document, not time spent at its top', () => {
    expect(readFor(100, 120, { range: [0, 0.5] }).qualified).toBe(false);
    let state = readFor(35, 120, { range: [0, 0.5] });
    for (let i = 0; i < 35; i++) state = sampleFocus(state, sample({ range: [0.5, 1] }), 120);
    expect(state.qualified).toBe(true);
    expect(state.activeMs).toBe(70_000);
    expect(state.coverage).toBe(1);
  });

  it('requires two seconds per band and rejects slivers and invalid geometry', () => {
    expect(readFor(1).coverage).toBe(0);
    expect(readFor(2).coverage).toBe(1);
    expect(readFor(2, 30, { range: [0, 0.001] }).coverage).toBe(0);
    for (const range of [[0, 0], [-1, 1], [0, 1.1], [0.8, 0.2], [0, NaN]] as [number, number][]) {
      expect(sampleFocus(createFocusState(), sample({ range }), 30).activeMs).toBe(0);
    }
  });
});

describe('Non-destructive reading history projection', () => {
  it('preserves legacy source-less events and labels them only in the projection', () => {
    const original = entry([event('first', T), event('repeat', T + 60_000)]);
    const snapshot = JSON.stringify(original);
    const result = projectReadingMemory(original, HASH, TEXT, undefined, T + HOUR);
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(result.totalReadCount).toBe(2);
    expect(result.readCount).toBe(1);
    expect(result.history.map(item => item.source)).toEqual(['legacy-manual', 'legacy-manual']);
    expect(result.history.map(item => item.effective)).toEqual([false, true]);
    expect(result.lastEffectiveAt).toBe(T);
    expect(result.lastReadAt).toBe(T + 60_000);
  });

  it('merges adjacent sub-thirty-minute activities without extending the freshness anchor', () => {
    const result = project([event('a', T), event('b', T + 20 * 60_000), event('c', T + 40 * 60_000)], T + HOUR);
    expect(result.episodes).toBe(1);
    expect(result.totalReadCount).toBe(3);
    expect(result.lastEffectiveAt).toBe(T);
    expect(project([event('a', T), event('b', T + 30 * 60_000)], T + HOUR).episodes).toBe(2);
  });

  it('same-session activity is one episode even hours apart; duplicate ids are not duplicate facts', () => {
    const result = project([event('a', T, { sessionId: 'session' }), event('a', T), event('b', T + 3 * HOUR, { sessionId: 'session' })], T + 4 * HOUR);
    expect(result.episodes).toBe(1);
    expect(result.totalReadCount).toBe(2);
    expect(result.lastEffectiveAt).toBe(T);
  });

  it('keeps revoked/future rows visible but excludes them from exposure and strength', () => {
    const result = project([event('past', T), event('future', T + DAY), event('voided', T - DAY, { voidedAt: T })]);
    expect(result.history).toHaveLength(3);
    expect(result.history.find(row => row.id === 'future')?.future).toBe(true);
    expect(result.history.find(row => row.id === 'voided')?.voidedAt).toBe(T);
    expect(result.totalReadCount).toBe(1);
    expect(result.strengthDays).toBe(1);
  });

  it('requires full current-content effort for automated evidence', () => {
    const focus = event('focus', T, { source: 'focus', sessionId: 's', activeMs: 20_000, coverage: 1 });
    expect(project([focus]).episodes).toBe(1);
    expect(projectReadingMemory(entry([focus]), HASH, '字'.repeat(2000), undefined, T).episodes).toBe(0);
    expect(project([event('short', T, { ...focus, activeMs: 19_999 })]).episodes).toBe(0);
    expect(project([event('narrow', T, { ...focus, coverage: 0.64 })]).episodes).toBe(0);
    expect(projectReadingMemory(entry([event('manual', T)]), HASH, '', undefined, T).freshness).toBeNull();
  });

  it('same-day readings refresh recency without growing the long-term half-life', () => {
    const result = project([event('a', T), event('b', T + 3 * HOUR)], T + 3 * HOUR);
    expect(result.episodes).toBe(2);
    expect(result.strengthDays).toBe(1);
    expect(result.effectiveStabilityDays).toBe(0.25);
    expect(result.freshness).toBe(1);
  });

  it('uses Shanghai midnight and does not count a merged cross-midnight repeat as a second day', () => {
    const before = Date.UTC(2026, 9, 17, 15, 50);
    const near = Date.UTC(2026, 9, 17, 16, 10);
    const spaced = Date.UTC(2026, 9, 17, 16, 30);
    expect(dayBucket(spaced) - dayBucket(before)).toBe(1);
    expect(project([event('a', before), event('b', near)], near).strengthDays).toBe(1);
    const result = project([event('a', before), event('b', spaced)], spaced);
    expect(result.strengthDays).toBe(2);
    expect(result.effectiveStabilityDays).toBe(1);
  });

  it('isolates content versions while recovering the previous history if its content returns', () => {
    const events = [event('old', T - DAY), event('new', T, { contentHash: OTHER })];
    expect(project(events).lastEffectiveAt).toBe(T - DAY);
    const replacement = projectReadingMemory(entry(events), 'v3', TEXT, undefined, T);
    expect(replacement.versionChanged).toBe(true);
    expect(replacement.freshness).toBeNull();
    expect(replacement.totalReadCount).toBe(2);
    expect(project([event('future-old', T + DAY, { contentHash: OTHER })]).versionChanged).toBe(false);
  });

  it('freshness halves at six hours, follows configured scale once, and maps stages', () => {
    const events = [event('a', T)];
    expect(project(events, T).level).toBe('steady');
    expect(project(events, T + 6 * HOUR).freshness).toBeCloseTo(0.5);
    expect(project(events, T + 6 * HOUR).level).toBe('fading');
    expect(project(events, T + 12 * HOUR).level).toBe('due');
    expect(projectReadingMemory(entry(events), HASH, TEXT, { retentionScale: 2 }, T + 12 * HOUR).freshness).toBeCloseTo(0.5);
    expect(project([]).level).toBe('new');
    expect(project([]).freshness).toBeNull();
  });

  it('caps half-life at thirty days and computes ordered finite curves', () => {
    const events = Array.from({ length: 10 }, (_, i) => event(`e${i}`, T + i * DAY));
    const result = project(events, T + 10 * DAY);
    expect(result.strengthDays).toBe(10);
    expect(result.effectiveStabilityDays).toBe(30);
    expect(result.curve.length).toBeGreaterThan(10);
    expect(result.curve.every(point => Number.isFinite(Date.parse(point.at)) && point.retention >= 0 && point.retention <= 1)).toBe(true);
    expect(result.curve.every((point, i) => i === 0 || point.at >= result.curve[i - 1].at)).toBe(true);
  });

  it('manual priority overrides matching AI, stale AI falls back, and neither alters freshness', () => {
    const ai = { score: 0.9, reason: '基础概念', contentHash: HASH, goal: '', providerId: 'glm', model: 'test', rubricVersion: '1', scoredAt: T };
    const events = [event('a', T)];
    const baseline = project(events, T + HOUR);
    const model = project(events, T + HOUR, { priority: { ai } });
    const manual = project(events, T + HOUR, { priority: { ai, manual: 0 } });
    const stale = project(events, T + HOUR, { priority: { ai: { ...ai, contentHash: OTHER } } });
    expect(model.prioritySource).toBe('ai');
    expect(model.priority).toBe(0.9);
    expect(manual.prioritySource).toBe('manual');
    expect(manual.priority).toBe(0);
    expect(stale.prioritySource).toBe('default');
    expect(stale.priority).toBe(0.5);
    expect(stale.aiPriority?.reason).toBe('基础概念');
    for (const result of [model, manual, stale]) expect(result.freshness).toBe(baseline.freshness);
  });

  it('multiplies base priority by forgetting without inventing evidence for unseen content', () => {
    const events = [event('a', T)];
    expect(project([]).forgettingFactor).toBe(0);
    expect(project([]).recommendation).toBe(0);
    expect(project(events).recommendation).toBe(0);
    const later = project(events, T + 6 * HOUR, { priority: { manual: 0.8 } });
    expect(later.forgettingFactor).toBeCloseTo(0.5);
    expect(later.recommendation).toBeCloseTo(0.4);
    expect(project(events, T + 6 * HOUR, { priority: { manual: 0 } }).recommendation).toBe(0);
  });

  it('changes forgetting influence independently of the original score and reading curve', () => {
    const original = entry([event('a', T)], { priority: { manual: 0.8 } });
    const snapshot = JSON.stringify(original);
    const subtle = projectReadingMemory(original, HASH, TEXT, { retentionScale: 1, forgettingExponent: 2 }, T + 6 * HOUR);
    const stronger = projectReadingMemory(original, HASH, TEXT, { retentionScale: 1, forgettingExponent: 0.5 }, T + 6 * HOUR);
    expect(subtle.forgettingFactor).toBeCloseTo(0.25);
    expect(subtle.recommendation).toBeCloseTo(0.2);
    expect(stronger.forgettingFactor).toBeCloseTo(Math.sqrt(0.5));
    expect(stronger.freshness).toBe(subtle.freshness);
    expect(stronger.priority).toBe(subtle.priority);
    expect(stronger.curve).toEqual(subtle.curve);
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});
