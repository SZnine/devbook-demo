import manual from '../manual-demo/manual.json';
import { isCollectionDeleted, type Collection, type ContentRef, type NotebookState } from './store';

export { manual };
export const sectionMap = new Map(manual.sections.map(section => [section.id, section]));
export const refKey = (ref: ContentRef) => `${ref.kind}:${ref.id}`;
export const shortTitle = (title: string) => title.replace(/^[A-Z]+\d+\s+(?:P\d\s+)?/, '');
export function noteTitle(markdown: string) {
  return markdown.split('\n').find(line => line.trim())?.replace(/^#+\s*/, '').replace(/[*`_[\]]/g, '').slice(0, 90) || '未命名随笔';
}
export function parentFor(id: string, state: Pick<NotebookState, 'collections'>) {
  return state.collections.find(collection => collection.items.some(item => item.kind === 'chapter' && item.id === id));
}
export function collectionKind(id: string, state: Pick<NotebookState, 'collections'>): 'book' | 'chapter' {
  return parentFor(id, state) ? 'chapter' : 'book';
}
export function collectionPath(id: string, state: Pick<NotebookState, 'collections'>): Collection[] {
  const path: Collection[] = [];
  const seen = new Set<string>();
  let current = state.collections.find(collection => collection.id === id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = parentFor(current.id, state);
  }
  return path;
}
export function rootCollections(state: Pick<NotebookState, 'collections'>, includeArchived = false) {
  const nested = new Set(state.collections.flatMap(collection => collection.items.filter(item => item.kind === 'chapter').map(item => item.id)));
  return state.collections.filter(collection => !nested.has(collection.id) && !isCollectionDeleted(collection.id, state) && (includeArchived || collection.archivedAt === undefined));
}
export function titleFor(ref: ContentRef, state: NotebookState) {
  if (ref.kind === 'chapter') return state.collections.find(collection => collection.id === ref.id)?.title ?? '未命名章节';
  if (ref.kind === 'section') return shortTitle(sectionMap.get(ref.id)?.title ?? '原文');
  const note = state.notes.find(item => item.id === ref.id);
  return noteTitle(note?.markdown.trim() || note?.source?.quote || '');
}
export function bodyFor(ref: ContentRef, state: NotebookState) {
  if (ref.kind === 'chapter') return '';
  return ref.kind === 'section' ? sectionMap.get(ref.id)?.parts.map(part => part.markdown).join('\n\n') ?? '' : state.notes.find(note => note.id === ref.id)?.markdown ?? '';
}
export function previewFor(ref: ContentRef, state: NotebookState) {
  if (ref.kind === 'chapter') return '';
  const raw = ref.kind === 'section'
    ? sectionMap.get(ref.id)?.parts.filter(part => part.role === 'prompt' || part.role === 'body').map(part => part.markdown).join('\n') ?? ''
    : bodyFor(ref, state).split('\n').slice(1).join('\n');
  return raw.replace(/[#*`>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 115);
}
export function memoryExcerptFor(ref: ContentRef, state: NotebookState) {
  const body = ref.kind === 'note' ? bodyFor(ref, state).split('\n').slice(1).join('\n') : bodyFor(ref, state);
  const text = body.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '').replace(/^#{1,6}\s+.*$/gm, '');
  const paragraph = text.split(/\n\s*\n/).find(part => part.trim()) ?? '';
  return paragraph.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[#*`>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 140);
}
export function tagsFor(markdown: string): string[] {
  const prose = markdown.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`]*`/g, '');
  return [...new Set([...prose.matchAll(/(?:^|\s)#([\p{L}\p{N}_][\p{L}\p{N}_/\-]*)/gu)].map(match => match[1]))];
}
export const phases = [
  { id: 'new', title: '未记录', hint: '当前内容尚无有效阅读' },
  { id: 'due', title: '已渐远', hint: '阅读新鲜度低于 35%' },
  { id: 'fading', title: '仍有印象', hint: '阅读新鲜度 35%–75%' },
  { id: 'steady', title: '刚读过', hint: '阅读新鲜度不低于 75%' },
] as const;

export function isCollectionArchived(id: string, state: Pick<NotebookState, 'collections'>): boolean {
  const seen = new Set<string>();
  let current = state.collections.find(item => item.id === id);
  while (current && !seen.has(current.id)) {
    if (current.archivedAt !== undefined || current.deletedAt !== undefined) return true;
    seen.add(current.id); current = parentFor(current.id, state);
  }
  return false;
}
