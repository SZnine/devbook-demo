import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { bodyFor, collectionPath, manual, noteTitle, refKey, sectionMap, shortTitle, titleFor } from './content';
import { captureChapterSelection, readChapterMarkdown, type ChapterSelection } from './editor-selection';
import { markdownHeadingTitles, snapshotAssistantSelection, type AssistantContextSelection, type AssistantSelectionMetadata } from './assistant-context';
import type { Collection, MemoSource, NotebookState, Ref } from './store';

type ReadingLocation = { page: string; collectionId: string | null; topicId: string | null };
const sourceSelector = '[data-ai-owner],.nb-memo,.nb-source,.nb-detail,.nb-composer,.cw-new-editor,.nb-memo-source';
const assistantSelector = '.nb-assistant-trigger,#notebook-assistant';

function elementFor(node: Node | null): HTMLElement | null {
  return node instanceof HTMLElement ? node : node?.parentElement ?? null;
}

function contentRef(key: string | undefined): Ref | undefined {
  if (!key) return undefined;
  const separator = key.indexOf(':');
  const kind = key.slice(0, separator);
  return (kind === 'note' || kind === 'section') && separator >= 0 ? { kind, id: key.slice(separator + 1) } : undefined;
}

function chapterMetadata(owner: Collection | undefined, state: NotebookState, liveRef?: Ref, liveMarkdown?: string) {
  if (!owner) return {};
  const path = collectionPath(owner.id, state);
  const chapterHeadings = owner.items.flatMap(ref => {
    if (ref.kind === 'chapter') {
      const child = state.collections.find(item => item.id === ref.id && item.deletedAt === undefined && item.archivedAt === undefined);
      return child ? [child.title] : [];
    }
    if (ref.kind === 'note' && state.notes.find(note => note.id === ref.id)?.archivedAt !== undefined) return [];
    const body = liveRef && refKey(ref) === refKey(liveRef) && liveMarkdown !== undefined ? liveMarkdown : bodyFor(ref, state);
    const headings = markdownHeadingTitles(body);
    return headings.length ? headings : [owner.titles?.[refKey(ref)] ?? titleFor(ref, state)];
  });
  return { bookTitle: path[0]?.title, chapterTitle: path.length > 1 ? owner.title : undefined, chapterHeadings };
}

function selectionId(base: string, captured: ChapterSelection) {
  // Distinguish repeated words by their position context without keeping a DOM Range.
  const value = `${captured.context?.start ?? ''}\0${captured.before}\0${captured.markdown}\0${captured.after}`;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return `${base}:${(hash >>> 0).toString(36)}`;
}

function sourceMetadata(source: MemoSource, state: NotebookState): AssistantSelectionMetadata {
  const owner = state.collections.find(item => item.id === source.collectionId);
  return {
    id: `quote:${source.collectionId}:${source.ref ? refKey(source.ref) : 'summary'}:${source.capturedAt}`,
    title: source.contextTitle ?? source.title,
    bodyMarkdown: source.contextMarkdown ?? source.quote,
    ...chapterMetadata(owner, state),
    // A quotation keeps its original location even after the source is moved or renamed.
    bookTitle: source.path[0],
    chapterTitle: source.path.length > 1 ? source.path.at(-1) : undefined,
  };
}

/** Read only the real, current selection, before a toolbar takes keyboard focus. */
function captureAssistantSelection(state: NotebookState, location: ReadingLocation, root: HTMLElement): AssistantContextSelection | null {
  const active = document.activeElement;
  const sourceField = active instanceof HTMLTextAreaElement && root.contains(active) && active.closest('.chapter-editor-host') ? active : null;
  const selected = window.getSelection();
  const range = !sourceField && selected?.rangeCount ? selected.getRangeAt(0) : null;
  if (sourceField ? sourceField.selectionStart === sourceField.selectionEnd : !range || range.collapsed) return null;
  const anchor = sourceField ?? elementFor(range!.startContainer);
  const end = sourceField ?? elementFor(range!.endContainer);
  if (!anchor || !end || !root.contains(anchor) || !root.contains(end) || anchor.closest('[hidden],[inert],[aria-hidden="true"]')) return null;
  const container = anchor.closest<HTMLElement>(sourceSelector);
  if (!container || !container.contains(end)) return null;
  const editor = anchor.closest<HTMLElement>('.chapter-editor-host');
  const rendered = anchor.closest<HTMLElement>('.markdown');
  // Do not let a selection spanning unrelated cards or separate manual parts
  // become an attachment carrying the metadata of just the first card.
  if (!editor && (!rendered || !rendered.contains(end))) return null;
  const captureRoot = editor ?? rendered!;
  const liveMarkdown = editor ? readChapterMarkdown(editor) : null;
  let metadata: AssistantSelectionMetadata | null = null;
  let fixedSource: MemoSource | undefined;
  let captureBody: string | undefined;

  const citation = anchor.closest<HTMLElement>('.nb-memo-source');
  const memo = anchor.closest<HTMLElement>('.nb-memo');
  const memoId = memo?.id.startsWith('note-') ? memo.id.slice(5) : undefined;
  const memoNote = memoId ? state.notes.find(note => note.id === memoId) : undefined;
  if (citation) {
    fixedSource = memoNote?.source ?? (!memo ? state.draft.source : undefined);
    if (!fixedSource) return null;
    metadata = sourceMetadata(fixedSource, state);
    captureBody = anchor.closest('.nb-memo-context-selection') ? fixedSource.contextMarkdown : fixedSource.quote;
  } else {
    const owned = anchor.closest<HTMLElement>('[data-ai-owner]');
    if (owned) {
      const owner = state.collections.find(item => item.id === owned.dataset.aiOwner);
      if (!owner) return null;
      const ref = contentRef(owned.dataset.aiRef ?? owned.dataset.cwKey ?? owned.dataset.readingKey);
      const body = liveMarkdown ?? (ref ? bodyFor(ref, state) : owner.summary ?? '');
      const newBody = owned.matches('.cw-new-editor');
      metadata = { id: `chapter:${owner.id}:${ref ? refKey(ref) : newBody ? 'draft' : 'summary'}`, title: newBody ? noteTitle(body) : ref ? owner.titles?.[refKey(ref)] ?? titleFor(ref, state) : '摘要',
        bodyMarkdown: body, ...chapterMetadata(owner, state, ref, body) };
      if (newBody && !ref) metadata.chapterHeadings = [...(metadata.chapterHeadings ?? []), ...markdownHeadingTitles(body)];
      captureBody = body;
    } else if (memoNote) {
      const body = liveMarkdown ?? memoNote.markdown;
      metadata = { id: `memo:${memoNote.id}`, title: noteTitle(body), bodyMarkdown: body };
      captureBody = body;
    } else if (container.matches('.nb-source,.nb-detail')) {
      const ref = container.id.startsWith('source-') ? { kind: 'section' as const, id: container.id.slice(7) } : contentRef(container.dataset.readingKey);
      if (!ref) return null;
      const body = bodyFor(ref, state);
      if (ref.kind === 'section') {
        const section = sectionMap.get(ref.id);
        if (!section) return null;
        const topic = manual.topics.find(item => item.sectionIds.includes(ref.id));
        metadata = { id: `manual:${ref.id}`, title: shortTitle(section.title), bodyMarkdown: body,
          bookTitle: manual.title, chapterTitle: topic?.title,
          chapterHeadings: topic?.sectionIds.map(id => shortTitle(sectionMap.get(id)?.title ?? '')).filter(Boolean) ?? [] };
        // SourceBody renders separate parts. Its single part's heading ordinal
        // cannot safely index headings in the concatenated complete section.
        captureBody = undefined;
      } else {
        metadata = { id: `memo:${ref.id}`, title: titleFor(ref, state), bodyMarkdown: body };
        captureBody = body;
      }
    } else if (editor && container.matches('.nb-composer,.cw-new-editor')) {
      const body = liveMarkdown ?? state.draft.markdown;
      if (container.matches('.cw-new-editor')) {
        const ownerId = container.closest<HTMLElement>('[data-ai-owner]')?.dataset.aiOwner ?? location.collectionId;
        const owner = state.collections.find(item => item.id === ownerId);
        metadata = { id: `chapter-draft:${ownerId ?? ''}`, title: noteTitle(body), bodyMarkdown: body, ...chapterMetadata(owner, state) };
      } else metadata = { id: `memo-draft:${state.draft.editingId ?? 'new'}`, title: noteTitle(body), bodyMarkdown: body };
      captureBody = body;
    }
  }
  if (!metadata) return null;
  const captured = captureChapterSelection(captureRoot, captureBody);
  if (!captured) return null;
  const snapshot = snapshotAssistantSelection(captured, { ...metadata, id: selectionId(metadata.id, captured) });
  if (snapshot && fixedSource) {
    snapshot.sectionTitle = fixedSource.contextTitle ?? fixedSource.title;
    snapshot.sectionMarkdown = fixedSource.contextMarkdown ?? fixedSource.quote;
  }
  return snapshot;
}

export function useAssistantSelection(
  state: NotebookState | null,
  location: ReadingLocation,
  root: RefObject<HTMLElement | null>,
): AssistantContextSelection | null {
  const latest = useRef({ state, location });
  latest.current = { state, location };
  const [snapshot, setSnapshot] = useState<AssistantContextSelection | null>(null);
  const fingerprint = useRef('');
  const key = `${location.page}:${location.collectionId ?? ''}:${location.topicId ?? ''}`;
  const ready = Boolean(state);
  useLayoutEffect(() => { fingerprint.current = ''; setSnapshot(null); }, [key]);

  useEffect(() => {
    if (!ready) return;
    let reading = false;
    let frame = 0;
    const publish = (next: AssistantContextSelection | null) => {
      const signature = next ? JSON.stringify(next) : '';
      if (signature === fingerprint.current) return;
      fingerprint.current = signature;
      setSnapshot(next);
    };
    const capture = () => {
      const current = latest.current;
      publish(current.state && root.current ? captureAssistantSelection(current.state, current.location, root.current) : null);
    };
    const queueCapture = () => {
      if (!reading) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(capture);
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = elementFor(event.target as Node | null);
      if (!target) return;
      const inAssistant = target.closest(assistantSelector);
      if (inAssistant || !root.current?.contains(target)) {
        // Capture textarea offsets while it is still the active field.
        if (reading) capture();
        reading = false;
        cancelAnimationFrame(frame);
        return;
      }
      reading = Boolean(target.closest(sourceSelector));
      // A fresh content click replaces the previous candidate. The pointer-up
      // captures the resulting selection; a collapsed caret leaves it empty.
      publish(null);
    };
    const onFocus = (event: FocusEvent) => {
      const target = elementFor(event.target as Node | null);
      if (!target) return;
      if (target.closest(assistantSelector) || !root.current?.contains(target)) { reading = false; cancelAnimationFrame(frame); }
      else { reading = Boolean(target.closest(sourceSelector)); if (reading) queueCapture(); else publish(null); }
    };
    const onKeyOrSelect = (event: Event) => {
      const target = elementFor(event.target as Node | null);
      // Browsers may dispatch a textarea's queued select event after a panel
      // checkbox has taken focus. Its retained offsets are no longer a live
      // source selection and must not restart capture or erase the snapshot.
      if (target instanceof HTMLTextAreaElement && document.activeElement !== target) return;
      if ((event.type === 'input' || event.type === 'select') && (!root.current?.contains(document.activeElement) || document.activeElement?.closest(assistantSelector))) return;
      if (target && root.current?.contains(target) && !target.closest(assistantSelector)) reading = Boolean(target.closest(sourceSelector));
      queueCapture();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (reading && event.key === 'Tab') { capture(); cancelAnimationFrame(frame); }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerup', queueCapture, true);
    document.addEventListener('selectionchange', queueCapture);
    document.addEventListener('select', onKeyOrSelect, true);
    document.addEventListener('keyup', onKeyOrSelect, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('input', onKeyOrSelect, true);
    document.addEventListener('focusin', onFocus, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointerup', queueCapture, true);
      document.removeEventListener('selectionchange', queueCapture);
      document.removeEventListener('select', onKeyOrSelect, true);
      document.removeEventListener('keyup', onKeyOrSelect, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('input', onKeyOrSelect, true);
      document.removeEventListener('focusin', onFocus, true);
    };
  }, [ready, key, root]);
  return snapshot;
}
