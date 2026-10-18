import { test } from 'vitest';
import assert from 'node:assert/strict';
import { contentFingerprint, DAY_MS, DUE_RETENTION, intervalAt, MIN_EPISODE_GAP_MS, normalizeMemorySettings, projectMemory, retentionAt } from '../src/memory/memory-engine.mjs';

const T = Date.UTC(2026, 9, 10, 0);
const H = `sha256:${'a'.repeat(64)}`;
const OTHER = `sha256:${'b'.repeat(64)}`;
const MINUTE = 1 / 1440;
const FIRST_S = 10 / 1440;
const read = (id, day, extras = {}) => ({ id, at: T + day * DAY_MS, contentHash: H, sectionVersion: 1, documentRevision: H, ...extras });
const entry = events => ({ id: 'doc/part', documentId: 'doc', sectionId: 'part', documentTitle: 'Document', title: 'Part', addedAt: T, active: true, events });
const project = (events, day, scale = 1, hash = H) => projectMemory(entry(events), hash, { retentionScale: scale }, T + day * DAY_MS);
const near = (actual, expected, tolerance = 1e-12) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test('not enrolled and enrolled-unread states have no invented probability', () => {
  for (const value of [null, entry([])]) {
    const state = projectMemory(value, H, { retentionScale: 1 }, T);
    assert.equal(state.retention, null);
    assert.equal(state.stabilityDays, null);
    assert.equal(state.nextDueAt, null);
    assert.equal(state.level, 'new');
    assert.equal(state.readCount, 0);
    assert.equal(state.effectiveEpisodes, 0);
    assert.deepEqual(state.curve, []);
  }
});

test('fingerprints reflect authored content but ignore derived AST, sources and object key order', () => {
  const section = { id: 's', title: 'Title', layout: 'reading', parts: [{ id: 'p', label: 'Body', role: 'body', markdown: '**text**' }] };
  const enriched = { ...section, source: { file: 'other.md' }, version: 8, parts: [{ ...section.parts[0], ast: { children: [] }, source: { start: 40 } }] };
  const reordered = { parts: section.parts.map(part => ({ markdown: part.markdown, label: part.label, role: part.role, id: part.id })), layout: section.layout, title: section.title, id: section.id };
  assert.equal(contentFingerprint(section), contentFingerprint(enriched));
  assert.equal(contentFingerprint(section), contentFingerprint(reordered));
  for (const key of ['id', 'title', 'layout']) assert.notEqual(contentFingerprint(section), contentFingerprint({ ...section, [key]: `${section[key]} changed` }));
  for (const key of ['id', 'role', 'label', 'markdown']) assert.notEqual(contentFingerprint(section), contentFingerprint({ ...section, parts: [{ ...section.parts[0], [key]: 'changed' }] }));
  assert.throws(() => contentFingerprint({}), TypeError);
});

test('FSRS-6 curve obeys its defining timescale and is bounded and monotone', () => {
  near(retentionAt(0, 1), 1);
  near(retentionAt(1, 1), 0.9);
  near(retentionAt(2, 1, 2), 0.9);
  near(retentionAt(-4, 1), 1);
  let previous = 1;
  for (const day of [0, 0.01, 0.1, 0.5, 1, 7, 30, 365, 100_000]) {
    const retention = retentionAt(day, 1);
    assert.ok(retention > 0 && retention <= previous && retention <= 1);
    previous = retention;
  }
  assert.throws(() => retentionAt(1, 0), RangeError);
  assert.throws(() => retentionAt(NaN, 1), RangeError);
});

test('manual first read starts a ten-minute timescale, with a separate 70-percent reminder', () => {
  const state = project([read('a', 0)], 0);
  assert.equal(state.readCount, 1);
  assert.equal(state.effectiveEpisodes, 1);
  assert.equal(state.stabilityDays, FIRST_S);
  assert.equal(state.retention, 1);
  near((state.nextDueAt - T) / 60_000, 92.87911182417021, 1e-8);
  assert.equal(state.level, 'steady');
  assert.equal(project([read('a', 0)], 10 * MINUTE).level, 'steady');
  assert.equal(project([read('a', 0)], 20 * MINUTE).level, 'fading');
  assert.equal(project([read('a', 0)], 93 * MINUTE).level, 'due');
});

test('first-exposure estimates decrease visibly across minutes and hours, without inventing new reads', () => {
  const minutes = [1, 5, 20, 60, 480, 1440];
  const percentages = [98.57, 94.03, 84.59, 74.27, 55.04, 46.56];
  let previous = 1;
  for (const [index, minute] of minutes.entries()) {
    const state = project([read('a', 0)], minute * MINUTE);
    near(state.retention * 100, percentages[index], 0.005);
    assert.ok(state.retention < previous);
    assert.equal(state.readCount, 1);
    assert.equal(state.effectiveEpisodes, 1);
    previous = state.retention;
  }
});

test('inverse curve separates the 90-percent timescale from reminder policy and applies scale once', () => {
  for (const scale of [0.25, 0.5, 1, 2, 4]) {
    near(intervalAt(0.9, FIRST_S, scale), FIRST_S * scale);
    const interval = intervalAt(DUE_RETENTION, FIRST_S, scale);
    near(retentionAt(interval, FIRST_S, scale), DUE_RETENTION);
    near(interval, intervalAt(DUE_RETENTION, FIRST_S) * scale);
    const before = project([read('a', 0)], interval - MINUTE / 60, scale);
    const after = project([read('a', 0)], interval + MINUTE / 60, scale);
    assert.equal(before.level, 'fading');
    assert.equal(after.level, 'due');
  }
  near(intervalAt(1, FIRST_S), 0);
  for (const invalid of [0, -1, 1.1, NaN]) assert.throws(() => intervalAt(invalid, FIRST_S), RangeError);
});

test('dense clicks count as facts without growing stability or moving the curve anchor', () => {
  const events = Array.from({ length: 100 }, (_, index) => read(`r${index}`, 0, { at: T + index * 5_000 }));
  const state = project(events, 1);
  assert.equal(state.readCount, 100);
  assert.equal(state.effectiveEpisodes, 1);
  assert.equal(state.stabilityDays, FIRST_S);
  assert.equal(state.lastEffectiveAt, T);
  assert.equal(state.lastReadAt, events.at(-1).at);
  near(state.retention, retentionAt(1, FIRST_S));
  assert.equal(state.nextDueAt, project([events[0]], 1).nextDueAt);
});

test('episode window is anchored to the effective read, not the preceding incidental click', () => {
  const state = project([
    read('a', 0), read('b', 0, { at: T + MIN_EPISODE_GAP_MS - 1 }),
    read('c', 0, { at: T + MIN_EPISODE_GAP_MS }),
  ], 1);
  assert.equal(state.effectiveEpisodes, 2);
  assert.equal(state.lastEffectiveAt, T + MIN_EPISODE_GAP_MS);
  assert.ok(state.stabilityDays > FIRST_S);
});

test('bounded exposure benefit no longer stalls on an ordinary overnight gap', () => {
  const peakGap = intervalAt(0.5, FIRST_S);
  const atPeak = project([read('a', 0), read('b', peakGap)], peakGap);
  const short = project([read('a', 0), read('b', 10 * MINUTE)], 10 * MINUTE);
  const overnight = project([read('a', 0), read('b', 1)], 1);
  const long = project([read('a', 0), read('b', 100_000)], 100_000);
  near(atPeak.stabilityDays, FIRST_S * 1.5, 1e-10);
  assert.ok(short.stabilityDays < atPeak.stabilityDays);
  assert.ok(long.stabilityDays < atPeak.stabilityDays);
  assert.ok(overnight.stabilityDays > FIRST_S * 1.49);
  near(short.stabilityDays / MINUTE, 11.8);
  assert.ok(long.stabilityDays < overnight.stabilityDays);
  assert.equal(long.retention, 1);
  const daily = project([read('a', 0), read('b', 1), read('c', 2)], 2);
  assert.ok(daily.stabilityDays > overnight.stabilityDays);
});

test('long histories stay bounded at 180 days, and input event order is irrelevant', () => {
  const events = [read('r0', 0)];
  let at = 0;
  let stability = FIRST_S;
  for (let i = 1; i < 80; i++) {
    at += intervalAt(0.5, stability);
    events.push(read(`r${i}`, at));
    stability = Math.min(180, stability * 1.5);
  }
  const state = project(events, at);
  near(state.stabilityDays, 180, 1e-8);
  assert.deepEqual(state, project([...events].reverse(), at));
  assert.ok(state.curve.length < 230);
});

test('personal scale changes decay and due time but not exposure facts or base stability', () => {
  const events = [read('a', 0), read('b', 1), read('c', 3)];
  const before = JSON.stringify(events);
  const fast = project(events, 4, 0.5);
  const slow = project(events, 4, 2);
  assert.ok(fast.retention < slow.retention);
  assert.ok(fast.nextDueAt < slow.nextDueAt);
  assert.equal(fast.stabilityDays, slow.stabilityDays);
  assert.equal(fast.readCount, slow.readCount);
  assert.equal(fast.effectiveEpisodes, slow.effectiveEpisodes);
  assert.equal(JSON.stringify(events), before);
  assert.deepEqual(normalizeMemorySettings({ retentionScale: 99 }), { retentionScale: 4 });
  assert.deepEqual(normalizeMemorySettings({ retentionScale: -1 }), { retentionScale: 0.25 });
  assert.deepEqual(normalizeMemorySettings({ retentionScale: NaN }), { retentionScale: 1 });
});

test('voiding replays surviving activities and never leaves stale stability state', () => {
  const events = [read('a', 0), read('b', 1), read('c', 2)];
  const undone = project(events.map(event => event.id === 'b' ? { ...event, voidedAt: T + 3 * DAY_MS } : event), 3);
  const without = project(events.filter(event => event.id !== 'b'), 3);
  assert.deepEqual(undone, without);
  assert.equal(undone.totalReadCount, 2);
});

test('content replacement isolates estimates, and restoring identical content reuses its original dates', () => {
  const events = [read('a', 0), read('b', 1, { contentHash: OTHER, sectionVersion: 2 })];
  const restored = project(events, 5, 1, H);
  const original = project([events[0]], 5);
  assert.equal(restored.readCount, 1);
  assert.equal(restored.totalReadCount, 2);
  assert.equal(restored.retention, original.retention);
  assert.equal(restored.lastReadAt, T);
  assert.equal(restored.versionChanged, false);
  const newVersion = project(events, 5, 1, `sha256:${'c'.repeat(64)}`);
  assert.equal(newVersion.retention, null);
  assert.equal(newVersion.readCount, 0);
  assert.equal(newVersion.totalReadCount, 2);
  assert.equal(newVersion.versionChanged, true);
});

test('future facts remain counts but cannot reset the current curve or pretend to be the last read', () => {
  const state = project([read('past', 0), read('future', 3)], 1);
  assert.equal(state.readCount, 2);
  assert.equal(state.effectiveEpisodes, 1);
  assert.equal(state.lastReadAt, T);
  near(state.retention, retentionAt(1, FIRST_S));
  assert.equal(state.history[0].future, true);
  const onlyFuture = project([read('future', 3)], 1);
  assert.equal(onlyFuture.retention, null);
  assert.equal(onlyFuture.lastReadAt, null);
});

test('projection tolerates duplicated IDs and malformed dates without counting a read twice', () => {
  const events = [read('a', 0), read('a', 0), read('bad', 0, { at: NaN }), read('bad2', 0, { at: -1 })];
  const state = project(events, 1);
  assert.equal(state.totalReadCount, 1);
  near(state.retention, retentionAt(1, FIRST_S));
  assert.throws(() => projectMemory(entry([]), H, { retentionScale: 1 }, NaN), RangeError);
});

test('chart contains historical decay, exposure jumps, current time and exact future threshold', () => {
  const now = 1 + 20 * MINUTE;
  const state = project([read('a', 0), read('b', 1)], now);
  const atReview = state.curve.filter(point => point.at === new Date(T + DAY_MS).toISOString());
  assert.equal(atReview.length, 2);
  near(atReview[0].retention, retentionAt(1, FIRST_S));
  near(atReview[1].retention, 1);
  const atNow = state.curve.find(point => point.at === new Date(T + now * DAY_MS).toISOString());
  near(atNow.retention, state.retention);
  const atDue = state.curve.find(point => point.at === new Date(state.nextDueAt).toISOString());
  near(atDue.retention, DUE_RETENTION, 1e-10);
  for (let i = 1; i < state.curve.length; i++) assert.ok(state.curve[i].at >= state.curve[i - 1].at);
});

test('chart preserves minute-scale curvature instead of forcing a one-day initial forecast', () => {
  const fresh = project([read('a', 0)], 0);
  for (const minute of [1, 5, 10, 20, 60]) {
    const point = fresh.curve.find(value => value.at === new Date(T + minute * 60_000).toISOString());
    assert.ok(point, `Missing ${minute}-minute point`);
    near(point.retention, retentionAt(minute * MINUTE, FIRST_S));
  }
  assert.equal(fresh.curve.at(-1).at, new Date(fresh.nextDueAt).toISOString());
  const overdue = project([read('a', 0)], 120 * MINUTE);
  assert.ok(Date.parse(overdue.curve.at(-1).at) - (T + 120 * 60_000) < 2 * 60 * 60_000);
});
