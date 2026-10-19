import { t } from '../i18n';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Nodes as MarkdownNode } from 'mdast';
import type { ChapterSelection } from './editor-selection';

export type AssistantContextLevel = 'selection' | 'section' | 'chapter';

export type AssistantContextSelection = {
  id: string;
  title: string;
  selectedMarkdown: string;
  sectionTitle: string;
  sectionMarkdown: string;
  chapterTitle?: string;
  chapterHeadings: string[];
  bookTitle?: string;
};

export type AssistantSelectionMetadata = {
  id: string;
  title: string;
  bodyMarkdown: string;
  chapterTitle?: string;
  chapterHeadings?: readonly string[];
  bookTitle?: string;
};

const parser = unified().use(remarkParse).use(remarkGfm);

function visibleHeadingText(node: MarkdownNode): string {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value;
  if (node.type === 'image' || node.type === 'imageReference') return node.alt ?? '';
  if (node.type === 'break') return ' ';
  return 'children' in node ? node.children.map(visibleHeadingText).join('') : '';
}

/** Keep the actual outline order, including duplicate titles. Examples are not outline entries. */
export function markdownHeadingTitles(markdown: string): string[] {
  return parser.parse(markdown).children
    .filter(node => node.type === 'heading')
    .map(visibleHeadingText)
    .filter(title => title.trim().length > 0);
}

/** The caller captures the live selection; this snapshot never retains an editor Range or a prior quote. */
export function snapshotAssistantSelection(
  captured: Pick<ChapterSelection, 'text' | 'markdown' | 'context'> | null,
  metadata: AssistantSelectionMetadata,
): AssistantContextSelection | null {
  if (!captured?.text.trim() || !captured.markdown.trim()) return null;
  return {
    id: metadata.id,
    title: captured.context?.title ?? metadata.title,
    selectedMarkdown: captured.markdown,
    sectionTitle: captured.context?.title ?? metadata.title,
    // Use the position-aware section captured by the editor. Never search for
    // selected words: identical text may appear in several different sections.
    sectionMarkdown: captured.context?.markdown ?? metadata.bodyMarkdown,
    chapterTitle: metadata.chapterTitle,
    chapterHeadings: [...(metadata.chapterHeadings ?? [])],
    bookTitle: metadata.bookTitle,
  };
}

/** Expanded levels add only the requested material; they never silently send the whole book. */
export function buildAssistantContext(
  selections: AssistantContextSelection | readonly AssistantContextSelection[],
  level: AssistantContextLevel,
): string {
  const items: readonly AssistantContextSelection[] = Array.isArray(selections) ? selections : [selections as AssistantContextSelection];
  return items.map((item, index) => {
    const parts = [t(`参考 ${index + 1} · ${item.title}`, `Reference ${index + 1} · ${item.title}`), t("选中文字：", "Selected text:"), item.selectedMarkdown];
    if (level !== 'selection') {
      if (item.sectionTitle) parts.push(t(`所属小节：${item.sectionTitle}`, `Section: ${item.sectionTitle}`));
      if (item.sectionMarkdown) parts.push(t("小节完整正文（Markdown）：", "Full section (Markdown):"), item.sectionMarkdown);
    }
    if (level === 'chapter') {
      if (item.bookTitle) parts.push(t(`所属书籍：${item.bookTitle}`, `Book: ${item.bookTitle}`));
      if (item.chapterTitle) parts.push(t(`所属章节：${item.chapterTitle}`, `Chapter: ${item.chapterTitle}`));
      if (item.chapterHeadings.length) parts.push(t("章节内小节标题（按原顺序）：", "Chapter outline:"), ...item.chapterHeadings.map(title => `- ${title}`));
    }
    return parts.join('\n\n');
  }).join('\n\n---\n\n');
}
