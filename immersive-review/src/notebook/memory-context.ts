import { bodyFor, collectionPath, isCollectionArchived, manual, refKey, sectionMap, titleFor } from './content';
import type { NotebookState, Ref } from './store';

export type MemoryScoringContext = { chapterTitle?: string; sectionTitle: string; summary: string };

function plain(text: string) {
  return text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/g, '').replace(/^[\s#>\-*+]+/gm, '').replace(/[*_`~|]/g, '')
    .replace(/\s+/g, ' ').trim();
}

/** Bounded, local excerpts, not a second AI call. Include headings and passages across the text. */
export function compactReadingSummary(markdown: string): string {
  const prose = markdown.replace(/```[^\n]*\n[\s\S]*?```|~~~[^\n]*\n[\s\S]*?~~~/g, '');
  const headings = [...prose.matchAll(/^#{1,6}\s+(.+)$/gm)].map(match => plain(match[1]));
  const outline = [...new Set(headings)].join(' / ').slice(0, 120);
  const paragraphs = prose.replace(/^#{1,6}\s+.*$/gm, '').split(/\n\s*\n/).map(plain).filter(Boolean);
  // Sample start, middle and end so a long introduction cannot hide later technical content.
  const selected = [...new Set([0, Math.floor(paragraphs.length / 2), paragraphs.length - 1])]
    .map(index => paragraphs[index]).filter(Boolean);
  const budget = 360 - (outline ? outline.length + 10 : 0);
  const excerpt = selected.length ? selected.map(part => part.slice(0, Math.floor(budget / selected.length) - 3)).join(' … ')
    : plain(markdown.replace(/^\s*(`{3,}|~{3,}).*$/gm, '')).slice(0, budget);
  return `${outline ? `小节：${outline}。` : ''}${excerpt}`.slice(0, 360);
}

export function memoryScoringContext(ref: Ref, state: NotebookState): MemoryScoringContext {
  const owner = state.collections.find(collection => !isCollectionArchived(collection.id, state)
    && collection.items.some(item => item.kind === ref.kind && item.id === ref.id));
  const sourceSectionId = ref.kind === 'section' ? ref.id : state.notes.find(note => note.id === ref.id)?.sourceSectionId;
  const sourceTopic = sourceSectionId && sectionMap.has(sourceSectionId)
    ? manual.topics.find(topic => topic.sectionIds.includes(sourceSectionId)) : undefined;
  const chapterTitle = owner ? collectionPath(owner.id, state).map(collection => collection.title).join(' / ') : sourceTopic?.title;
  return { chapterTitle: chapterTitle?.slice(0, 100), sectionTitle: (owner?.titles?.[refKey(ref)] ?? titleFor(ref, state)).slice(0, 100), summary: compactReadingSummary(bodyFor(ref, state)) };
}
