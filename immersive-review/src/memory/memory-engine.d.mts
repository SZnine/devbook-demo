import type { MemoryEntry, MemoryRead, MemorySettingsValue } from './memory-store.mjs';

export type FingerprintSection = { id: string; title: string; layout: string; parts: { id: string; role: string; label: string; markdown: string }[] };
export type MemoryLevel = 'new' | 'due' | 'fading' | 'steady';
export type MemoryProjection = {
  modelVersion: string;
  readCount: number;
  totalReadCount: number;
  retention: number | null;
  /** Base exposure timescale to 90%; first read starts at ten minutes. Not the reminder interval. */
  stabilityDays: number | null;
  effectiveStabilityDays: number | null;
  effectiveEpisodes: number;
  /** Latest actual non-future click, including a click in the same short episode. */
  lastReadAt: number | null;
  /** Anchor used by the curve; short repeats never move it. */
  lastEffectiveAt: number | null;
  /** Crossing of the 70% engineering reminder threshold, including the personal multiplier once. */
  nextDueAt: number | null;
  level: MemoryLevel;
  /** Other content has been read, but the current fingerprint has never been read. */
  versionChanged: boolean;
  curve: { at: string; retention: number }[];
  history: (MemoryRead & { currentVersion: boolean; effective: boolean; future: boolean })[];
};
export const MEMORY_MODEL_VERSION: string;
export const DAY_MS: number;
export const MIN_EPISODE_GAP_MS: number;
export const STEADY_RETENTION: number;
export const DUE_RETENTION: number;
export const DEFAULT_MEMORY_SETTINGS: Readonly<MemorySettingsValue>;
export function normalizeMemorySettings(value: unknown): MemorySettingsValue;
export function contentFingerprint(section: FingerprintSection): string;
export function retentionAt(elapsedDays: number, stabilityDays: number, retentionScale?: number): number;
export function intervalAt(retention: number, stabilityDays: number, retentionScale?: number): number;
export function projectMemory(entry: MemoryEntry | null | undefined, currentHash: string, settings?: MemorySettingsValue, nowMs?: number): MemoryProjection;
