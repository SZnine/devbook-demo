import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/** Pure exposure projection, not a complete FSRS scheduler or a trained recall probability. */
export const MEMORY_MODEL_VERSION = 'read-exposure/0.2+fsrs6-curve';
export const DAY_MS = 86_400_000;
export const MIN_EPISODE_GAP_MS = 10 * 60_000;
export const DEFAULT_MEMORY_SETTINGS = Object.freeze({ retentionScale: 1 });
export const STEADY_RETENTION = 0.9;
export const DUE_RETENTION = 0.7;

// Curve shape: FSRS-6 default w20; https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm#fsrs-6
const DECAY = 0.1542;
const FACTOR = Math.pow(0.9, -1 / DECAY) - 1;
// Engineering priors for manual reading, NOT published FSRS stability updates or fitted research parameters.
const INITIAL_STABILITY_DAYS = 10 / (24 * 60);
const MAX_STABILITY_DAYS = 180;
const EXPOSURE_GAIN = 0.5;
const MAX_TIMESTAMP = 8_640_000_000_000_000;
const encoder = new TextEncoder();
const validTime = value => Number.isFinite(value) && value >= 0 && value <= MAX_TIMESTAMP;

export function normalizeMemorySettings(value) {
  const scale = value?.retentionScale;
  return { retentionScale: Number.isFinite(scale) ? Math.min(4, Math.max(0.25, scale)) : 1 };
}

/** A content identity survives AST/source regeneration and changes to other sections. */
export function contentFingerprint(section) {
  if (!section || !Array.isArray(section.parts)) throw new TypeError('A section with parts is required.');
  const text = value => {
    if (typeof value !== 'string') throw new TypeError('Content fields must be strings.');
    return value;
  };
  const content = {
    id: text(section.id), title: text(section.title), layout: text(section.layout),
    parts: section.parts.map(part => ({ id: text(part.id), role: text(part.role), label: text(part.label), markdown: text(part.markdown) })),
  };
  return `sha256:${bytesToHex(sha256(encoder.encode(JSON.stringify(content))))}`;
}

/** FSRS-6 power curve only. Days are elapsed REAL time; scale is applied once here. */
export function retentionAt(elapsedDays, stabilityDays, retentionScale = 1) {
  if (!Number.isFinite(elapsedDays) || !Number.isFinite(stabilityDays) || stabilityDays <= 0) throw new RangeError('Finite elapsed days and positive stability are required.');
  const scale = normalizeMemorySettings({ retentionScale }).retentionScale;
  return Math.pow(1 + FACTOR * Math.max(0, elapsedDays) / (stabilityDays * scale), -DECAY);
}

/** Inverse of the selected curve. A reminder threshold is a UI policy, not the definition of S. */
export function intervalAt(retention, stabilityDays, retentionScale = 1) {
  if (!Number.isFinite(retention) || retention <= 0 || retention > 1 || !Number.isFinite(stabilityDays) || stabilityDays <= 0) throw new RangeError('A retention in (0, 1] and positive stability are required.');
  const scale = normalizeMemorySettings({ retentionScale }).retentionScale;
  return stabilityDays * scale * (Math.pow(retention, -1 / DECAY) - 1) / FACTOR;
}

function readingFacts(entry) {
  const seen = new Set();
  return (Array.isArray(entry?.events) ? entry.events : []).filter(event => {
    if (!event || typeof event.id !== 'string' || !event.id || seen.has(event.id) || !validTime(event.at) || typeof event.contentHash !== 'string' || event.voidedAt != null) return false;
    seen.add(event.id);
    return true;
  }).slice().sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

function replayEpisodes(events) {
  const episodes = [];
  for (const event of events) {
    const previous = episodes.at(-1);
    if (previous && event.at - previous.at < MIN_EPISODE_GAP_MS) continue;
    let stabilityDays = INITIAL_STABILITY_DAYS;
    if (previous) {
      const gapDays = (event.at - previous.at) / DAY_MS;
      const beforeRead = retentionAt(gapDays, previous.stabilityDays);
      // Uncalibrated reading benefit, NOT a FSRS rating update or an empirically optimal review point.
      // It remains bounded and avoids the old exp(-gap/S) underflow after an ordinary overnight gap.
      const gain = 4 * beforeRead * (1 - beforeRead);
      stabilityDays = Math.min(MAX_STABILITY_DAYS, previous.stabilityDays * (1 + EXPOSURE_GAIN * gain));
    }
    episodes.push({ id: event.id, at: event.at, stabilityDays });
  }
  return episodes;
}

function createCurve(episodes, scale, now, dueAt) {
  if (!episodes.length) return [];
  // Last twelve effective episodes keep the chart bounded; the complete event history remains separate.
  const recent = episodes.slice(-12);
  const points = [];
  const add = (at, retention) => {
    const point = { at: new Date(at).toISOString(), retention };
    const previous = points.at(-1);
    if (!previous || previous.at !== point.at || previous.retention !== point.retention) points.push(point);
  };
  const sample = (episode, start, end, steps) => {
    const times = new Set([end]);
    // Preserve the fast initial bend even when an episode spans several days.
    for (const factor of [0.1, 0.5, 1, 2, 6, 18, 48, 144]) {
      const at = episode.at + factor * episode.stabilityDays * scale * DAY_MS;
      if (at > start && at < end) times.add(at);
    }
    for (let step = 1; step <= steps; step++) times.add(start + (end - start) * step / steps);
    for (const at of [...times].sort((a, b) => a - b)) add(at, retentionAt((at - episode.at) / DAY_MS, episode.stabilityDays, scale));
  };
  for (let i = 0; i < recent.length; i++) {
    const episode = recent[i];
    const end = recent[i + 1]?.at ?? now;
    add(episode.at, 1);
    sample(episode, episode.at, end, 6);
  }
  const last = recent.at(-1);
  // The 70% reminder crossing is distinct from S (the 90% unit). Avoid a forced one-day forecast.
  const end = Math.min(MAX_TIMESTAMP, dueAt > now ? dueAt : now + intervalAt(DUE_RETENTION, last.stabilityDays, scale) * DAY_MS);
  sample(last, now, end, 12);
  return points;
}

/**
 * Reads facts and projects the currently displayed content only. It never mutates the entry,
 * assigns a Good grade, trains parameters, or creates reading events for viewing/editing.
 * Future-dated facts remain countable but do not affect the model until their timestamp arrives.
 */
export function projectMemory(entry, currentHash, settings = DEFAULT_MEMORY_SETTINGS, nowMs = Date.now()) {
  if (!validTime(nowMs)) throw new RangeError('A valid current timestamp is required.');
  if (typeof currentHash !== 'string' || !currentHash) throw new TypeError('Current content hash is required.');
  const { retentionScale } = normalizeMemorySettings(settings);
  const facts = readingFacts(entry);
  const currentFacts = facts.filter(event => event.contentHash === currentHash);
  const pastFacts = currentFacts.filter(event => event.at <= nowMs);
  const episodes = replayEpisodes(pastFacts);
  const last = episodes.at(-1);
  const retention = last ? retentionAt((nowMs - last.at) / DAY_MS, last.stabilityDays, retentionScale) : null;
  const nextDueAt = last ? Math.min(MAX_TIMESTAMP, last.at + intervalAt(DUE_RETENTION, last.stabilityDays, retentionScale) * DAY_MS) : null;
  const effectiveIds = new Set(episodes.map(episode => episode.id));
  return {
    modelVersion: MEMORY_MODEL_VERSION,
    readCount: currentFacts.length,
    totalReadCount: facts.length,
    retention,
    stabilityDays: last?.stabilityDays ?? null,
    effectiveStabilityDays: last ? last.stabilityDays * retentionScale : null,
    effectiveEpisodes: episodes.length,
    lastReadAt: pastFacts.at(-1)?.at ?? null,
    lastEffectiveAt: last?.at ?? null,
    nextDueAt,
    level: retention === null ? 'new' : retention >= STEADY_RETENTION ? 'steady' : retention >= DUE_RETENTION ? 'fading' : 'due',
    versionChanged: currentFacts.length === 0 && facts.length > 0,
    curve: createCurve(episodes, retentionScale, nowMs, nextDueAt),
    history: facts.slice().reverse().map(event => ({
      ...event, currentVersion: event.contentHash === currentHash,
      effective: effectiveIds.has(event.id), future: event.at > nowMs,
    })),
  };
}
