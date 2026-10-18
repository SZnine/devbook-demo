import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const manual = read('../src/manual-demo/manual.json');
const files = ['core', 'applied', 'supplemental'].map(name => read(`../src/manual-demo/research/${name}.json`));
type Review = { sectionId: string; decision: string; reason: string; sourceIds: string[]; additions: { id: string; kind: string; title: string; body: string; sourceIds: string[] }[] };
const reviews = files.flatMap(file => file.reviews) as Review[];
const sources = files.flatMap(file => file.sources) as { id: string; url: string; title: string; publisher: string; checkedAt: string }[];

describe('manual editorial coverage and provenance', () => {
  it('covers every published section once and keeps section, part and topic references consistent', () => {
    expect(reviews).toHaveLength(manual.sections.length);
    expect(new Set(reviews.map(review => review.sectionId)).size).toBe(manual.sections.length);
    expect(reviews.map(review => review.sectionId).sort()).toEqual(manual.sections.map((section: { id: string }) => section.id).sort());
    const sectionIds = new Set(manual.sections.map((section: { id: string }) => section.id));
    expect(sectionIds.size).toBe(manual.sections.length);
    const topicSections = manual.topics.flatMap((topic: { sectionIds: string[] }) => topic.sectionIds);
    expect(new Set(topicSections).size).toBe(topicSections.length);
    expect([...topicSections].sort()).toEqual([...sectionIds].sort());
    for (const section of manual.sections) {
      expect(section.title.trim().length, section.id).toBeGreaterThan(0);
      expect(section.parts.length, section.id).toBeGreaterThan(0);
      expect(new Set(section.parts.map((part: { id: string }) => part.id)).size).toBe(section.parts.length);
      for (const part of section.parts) {
        expect(part.id.trim().length).toBeGreaterThan(0);
        expect(typeof part.markdown).toBe('string');
      }
    }
  });
  it('resolves all citations and gives every addition a title and attributable source', () => {
    const known = new Set(sources.map(source => source.id));
    expect(known.size).toBe(sources.length);
    const seen = new Set<string>();
    for (const source of sources) {
      expect(new URL(source.url).protocol).toBe('https:');
      expect(source.title.length).toBeGreaterThan(3);
      expect(source.publisher.length).toBeGreaterThan(1);
      expect(source.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    for (const review of reviews) {
      expect(['add', 'keep']).toContain(review.decision);
      expect(review.reason.length, review.sectionId).toBeGreaterThan(12);
      expect(review.decision === 'add').toBe(review.additions.length > 0);
      for (const id of review.sourceIds) expect(known.has(id), id).toBe(true);
      for (const item of review.additions) {
        expect(seen.has(item.id), item.id).toBe(false); seen.add(item.id);
        expect(['aside', 'lab', 'diagram', 'reference', 'comparison', 'steps']).toContain(item.kind);
        expect(item.title.length).toBeGreaterThan(3);
        expect(item.body.length).toBeGreaterThan(20);
        expect(item.sourceIds.length, item.id).toBeGreaterThan(0);
        for (const id of item.sourceIds) expect(known.has(id), id).toBe(true);
        expect(item.body).not.toMatch(/<script|javascript:|data:text\/html/i);
        if (item.kind === 'diagram') expect(item.body).toContain('```mermaid');
      }
    }
  });
});
