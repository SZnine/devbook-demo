import type { MemoryProjection } from '../memory/memory-engine.mjs';
import type { MemoryAiPriority, MemoryEntry, MemoryRead, MemorySettingsValue } from '../memory/memory-store.mjs';

/** Exposure heuristics, not measured recall probabilities or a fitted memory model. */
export const READING_POLICY = Object.freeze({
  mergeGapMs: 30 * 60_000,
  idleGraceMs: 90_000,
  maxSampleGapMs: 2_500,
  coverageThreshold: 0.65,
});
export const POLICY = READING_POLICY;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MAX_TIME = 8_640_000_000_000_000;
const HALF_LIFE_DAYS = [0.25, 1, 3, 7, 14, 30];
const BAND_COUNT = 12;
const BAND_SEEN_MS = 2_000;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const validTime = (value: unknown): value is number => finite(value) && value >= 0 && value <= MAX_TIME;
const compareId = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

export type FocusState = { activeMs: number; bands: number[]; coverage: number; qualified: boolean };
export type FocusSample = {
  deltaMs: number;
  visible: boolean;
  focused: boolean;
  reading: boolean;
  engaged: boolean;
  idleMs: number;
  range: readonly [number, number] | null;
};
export type ReadingHistory = Omit<MemoryRead, 'source'> & {
  source: 'manual' | 'focus' | 'legacy-manual';
  currentVersion: boolean;
  effective: boolean;
  future: boolean;
};
export type ReadingMemoryProjection = Omit<MemoryProjection, 'history'> & {
  freshness: number | null;
  episodes: number;
  strengthDays: number;
  estimatedSeconds: number;
  priority: number;
  forgettingFactor: number;
  recommendation: number;
  prioritySource: 'manual' | 'ai' | 'default';
  aiPriority?: MemoryAiPriority;
  history: ReadingHistory[];
};

/** Reading effort: Chinese characters, English words, and nonempty code lines. */
export function estimateSeconds(markdown: string): number {
  if (typeof markdown !== 'string' || !markdown.trim()) return 0;
  let codeLines = 0;
  let inFence = false;
  let fenceCharacter = '';
  let fenceLength = 0;
  const proseLines: string[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const fence = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence && (!inFence || (fence[1][0] === fenceCharacter && fence[1].length >= fenceLength))) {
      if (inFence) { inFence = false; fenceCharacter = ''; fenceLength = 0; }
      else { inFence = true; fenceCharacter = fence[1][0]; fenceLength = fence[1].length; }
      continue;
    }
    if (inFence) { if (line.trim()) codeLines++; }
    else proseLines.push(line);
  }
  const prose = proseLines.join('\n')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[#*_`~>|\[\]{}()\-+]/g, ' ')
    .replace(/^\s*\d+[.)]\s*/gm, '')
    .trim();
  if (!prose && !codeLines) return 0;
  const chineseCharacters = (prose.match(/\p{Script=Han}/gu) || []).length;
  const englishWords = (prose.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
  return clamp(Math.ceil(chineseCharacters / 5 + englishWords / 3 + codeLines * 5), 15, 900);
}

/** Explicit Shanghai calendar day, independent of device/browser timezone. */
export function dayBucket(at: number): number { return Math.floor((at + 8 * HOUR_MS) / DAY_MS); }

export function requiredActiveMs(targetSeconds: number): number {
  return finite(targetSeconds) && targetSeconds > 0 ? clamp(targetSeconds * 0.55, 20, 90) * 1_000 : Infinity;
}

export function createFocusState(): FocusState {
  return { activeMs: 0, bands: Array(BAND_COUNT).fill(0), coverage: 0, qualified: false };
}

/** Long timer gaps are dropped entirely; a narrow visible sliver earns proportional coverage. */
export function sampleFocus(state: FocusState, sample: FocusSample, targetSeconds: number): FocusState {
  const next: FocusState = {
    activeMs: finite(state?.activeMs) ? Math.max(0, state.activeMs) : 0,
    bands: Array.from({ length: BAND_COUNT }, (_, index) => finite(state?.bands?.[index]) ? Math.max(0, state.bands[index]) : 0),
    coverage: 0,
    qualified: Boolean(state?.qualified),
  };
  const range = sample?.range;
  const validRange = Array.isArray(range) && range.length === 2 && range.every(finite)
    && range[0] >= 0 && range[1] <= 1 && range[0] < range[1];
  const eligible = sample && sample.visible === true && sample.focused === true
    && sample.reading === true && sample.engaged === true
    && finite(sample.idleMs) && sample.idleMs >= 0 && sample.idleMs <= READING_POLICY.idleGraceMs
    && finite(sample.deltaMs) && sample.deltaMs > 0 && sample.deltaMs <= READING_POLICY.maxSampleGapMs
    && validRange && finite(targetSeconds) && targetSeconds > 0;
  if (eligible && range) {
    next.activeMs += sample.deltaMs;
    for (let index = 0; index < BAND_COUNT; index++) {
      const overlap = Math.max(0, Math.min(range[1], (index + 1) / BAND_COUNT) - Math.max(range[0], index / BAND_COUNT));
      next.bands[index] += sample.deltaMs * Math.min(1, overlap * BAND_COUNT);
    }
  }
  next.coverage = next.bands.filter(value => value + 1e-7 >= BAND_SEEN_MS).length / BAND_COUNT;
  next.qualified = finite(targetSeconds) && targetSeconds > 0
    && (next.qualified || (next.activeMs >= requiredActiveMs(targetSeconds) && next.coverage >= READING_POLICY.coverageThreshold));
  return next;
}

function qualifiedEvent(event: MemoryRead, targetSeconds: number): boolean {
  if (targetSeconds <= 0) return false;
  if (event.source === undefined || event.source === 'manual') return true;
  return event.source === 'focus' && typeof event.sessionId === 'string' && Boolean(event.sessionId)
    && finite(event.activeMs) && event.activeMs >= requiredActiveMs(targetSeconds)
    && finite(event.coverage) && event.coverage >= READING_POLICY.coverageThreshold && event.coverage <= 1;
}

type Episode = { id: string; at: number; baseHalfLifeDays: number };
function curveFor(episodes: Episode[], now: number, scale: number, dueAt: number | null): MemoryProjection['curve'] {
  const curve: MemoryProjection['curve'] = [];
  const recent = episodes.slice(-12);
  const add = (at: number, retention: number) => {
    const point = { at: new Date(Math.min(MAX_TIME, at)).toISOString(), retention };
    const previous = curve.at(-1);
    if (previous?.at !== point.at || previous?.retention !== point.retention) curve.push(point);
  };
  const sample = (episode: Episode, start: number, end: number) => {
    const halfLifeMs = episode.baseHalfLifeDays * scale * DAY_MS;
    for (let step = 1; step <= 12; step++) {
      const at = start + (end - start) * step / 12;
      add(at, 2 ** (-Math.max(0, at - episode.at) / halfLifeMs));
    }
  };
  for (let index = 0; index < recent.length; index++) {
    const episode = recent[index];
    add(episode.at, 1);
    sample(episode, episode.at, recent[index + 1]?.at ?? now);
  }
  const last = recent.at(-1);
  if (last) sample(last, now, Math.min(MAX_TIME, dueAt && dueAt > now ? dueAt : now + last.baseHalfLifeDays * scale * DAY_MS));
  return curve;
}

/** Replay preserves original logs. Old manual logs gain source labels only in this read model. */
export function projectReadingMemory(
  entry: MemoryEntry | null | undefined,
  currentHash: string,
  markdown: string,
  settings: MemorySettingsValue = { retentionScale: 1 },
  now = Date.now(),
): ReadingMemoryProjection {
  if (!validTime(now)) throw new RangeError('A valid current timestamp is required.');
  if (typeof currentHash !== 'string' || !currentHash) throw new TypeError('Current content hash is required.');
  const scale = finite(settings?.retentionScale) ? clamp(settings.retentionScale, 0.25, 4) : 1;
  const estimatedSeconds = estimateSeconds(markdown);
  const ids = new Set<string>();
  const facts = (Array.isArray(entry?.events) ? entry.events : []).filter(event => {
    if (!event || typeof event.id !== 'string' || !event.id || ids.has(event.id) || !validTime(event.at)
      || typeof event.contentHash !== 'string' || !event.contentHash) return false;
    ids.add(event.id);
    return true;
  }).slice().sort((a, b) => a.at - b.at || compareId(a.id, b.id));
  const validFacts = facts.filter(event => event.voidedAt == null && event.at <= now
    && qualifiedEvent(event, event.contentHash === currentHash ? estimatedSeconds : 15));
  const currentFacts = validFacts.filter(event => event.contentHash === currentHash);
  const episodes: Episode[] = [];
  const sessions = new Set<string>();
  const strengthBuckets = new Set<number>();
  let adjacentAt: number | null = null;
  for (const event of currentFacts) {
    if (event.sessionId && sessions.has(event.sessionId)) continue;
    if (event.sessionId) sessions.add(event.sessionId);
    if (!episodes.length || adjacentAt === null || event.at - adjacentAt >= READING_POLICY.mergeGapMs) {
      strengthBuckets.add(dayBucket(event.at));
      episodes.push({ id: event.id, at: event.at, baseHalfLifeDays: HALF_LIFE_DAYS[Math.min(strengthBuckets.size, HALF_LIFE_DAYS.length) - 1] });
    }
    adjacentAt = event.at;
  }
  const last = episodes.at(-1);
  const halfLifeMs = last ? last.baseHalfLifeDays * scale * DAY_MS : null;
  const freshness = last && halfLifeMs ? 2 ** (-Math.max(0, now - last.at) / halfLifeMs) : null;
  const nextDueAt = last && halfLifeMs ? Math.min(MAX_TIME, last.at - Math.log2(0.35) * halfLifeMs) : null;
  const effectiveIds = new Set(episodes.map(episode => episode.id));
  const aiPriority = entry?.priority?.ai;
  const manual = entry?.priority?.manual;
  const validAi = aiPriority?.contentHash === currentHash && finite(aiPriority.score) && aiPriority.score >= 0 && aiPriority.score <= 1;
  const prioritySource = finite(manual) && manual >= 0 && manual <= 1 ? 'manual' : validAi ? 'ai' : 'default';
  const priority = prioritySource === 'manual' ? manual! : prioritySource === 'ai' ? aiPriority!.score : 0.5;
  // A missing reading episode is absence of evidence, not evidence of forgetting.
  const exponent = finite(settings?.forgettingExponent) ? clamp(settings.forgettingExponent, 0.5, 2) : 1;
  const forgettingFactor = (1 - (freshness ?? 1)) ** exponent;
  return {
    modelVersion: 'focus-reading-heuristic/1.0',
    readCount: episodes.length,
    totalReadCount: validFacts.length,
    effectiveEpisodes: episodes.length,
    episodes: episodes.length,
    strengthDays: strengthBuckets.size,
    freshness,
    retention: freshness,
    stabilityDays: last?.baseHalfLifeDays ?? null,
    effectiveStabilityDays: last ? last.baseHalfLifeDays * scale : null,
    estimatedSeconds,
    lastReadAt: currentFacts.at(-1)?.at ?? null,
    lastEffectiveAt: last?.at ?? null,
    nextDueAt,
    level: freshness === null ? 'new' : freshness < 0.35 ? 'due' : freshness < 0.75 ? 'fading' : 'steady',
    versionChanged: !episodes.length && validFacts.some(event => event.contentHash !== currentHash),
    curve: curveFor(episodes, now, scale, nextDueAt),
    history: facts.slice().reverse().map(event => ({ ...event, source: event.source ?? 'legacy-manual',
      currentVersion: event.contentHash === currentHash, effective: effectiveIds.has(event.id), future: event.at > now })),
    priority,
    forgettingFactor,
    recommendation: priority * forgettingFactor,
    prioritySource,
    aiPriority,
  };
}
