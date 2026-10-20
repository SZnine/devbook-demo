import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { isDocumentOutlineHeading } from './editor-selection';

export type BookOutlineEntry = { id: string; title: string; depth: number; element: HTMLElement };
type OutlineSnapshot = { key: string | null; entries: BookOutlineEntry[] };

const ignored = 'dialog,[role="dialog"],blockquote,li,code,.cw-toolbar,.cw-menu,.cw-chapter-directory,.cw-card-grid,.cw-card-open,.cw-child,.chapter-block-control,.chapter-editor-loading,.vditor-sv,.vditor-preview,.vditor-wysiwyg__preview,.vditor-ir__preview,[data-selection-ignore]';

/** Read actual rendered headings, including unsaved edits. Never add IDs to editor DOM. */
export function collectBookOutline(workspace: HTMLElement, identity: (heading: HTMLElement) => string): BookOutlineEntry[] {
  if (workspace.classList.contains('is-cards')) return [];
  const visibility = new WeakMap<Element, boolean>();
  const visible = (element: Element): boolean => {
    const cached = visibility.get(element);
    if (cached !== undefined) return cached;
    const style = element.ownerDocument.defaultView?.getComputedStyle(element);
    const ownVisible = !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true'
      && style?.display !== 'none' && style?.visibility !== 'hidden';
    const result = ownVisible && (element === workspace || !element.parentElement || visible(element.parentElement));
    visibility.set(element, result);
    return result;
  };

  return Array.from(workspace.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')).flatMap(heading => {
    if (heading.closest(ignored) || !visible(heading)) return [];
    const closedDetails = heading.closest('details:not([open])');
    if (closedDetails && !closedDetails.querySelector(':scope > summary')?.contains(heading)) return [];
    const editor = heading.closest('.chapter-editor');
    if (editor?.getAttribute('data-source-mode') === 'true') return [];
    const field = heading.closest<HTMLElement>('.vditor-wysiwyg [contenteditable="true"]');
    // The WYSIWYG field is a PRE itself. Use it as the boundary so code and
    // quoted example headings inside the document are excluded, not the field.
    const documentRoot = field ?? heading.closest<HTMLElement>('.markdown,.cw-prose')
      ?? (heading.parentElement?.matches('.cw-reading-chapter') ? heading.parentElement : null);
    if (!documentRoot || !isDocumentOutlineHeading(heading, documentRoot)) return [];
    const title = (heading.textContent ?? '').replace(/[\u200b\ufeff]/g, '').replace(/\s+/g, ' ').trim();
    let chapterDepth = 0;
    for (let parent = heading.parentElement; parent && parent !== workspace; parent = parent.parentElement) {
      if (parent.matches('.cw-reading-chapter')) chapterDepth++;
    }
    const level = Number(heading.tagName.slice(1));
    // Read-through wraps each document without rewriting its heading levels.
    const depth = chapterDepth ? (heading.parentElement?.matches('.cw-reading-chapter')
      ? chapterDepth + 1 : Math.max(2, level) + chapterDepth) : level;
    return title ? [{ id: identity(heading), title, depth, element: heading }] : [];
  });
}

export function useBookOutline(scrollRoot: RefObject<HTMLElement | null>, pageKey: string | null): OutlineSnapshot {
  const identities = useRef(new WeakMap<HTMLElement, string>());
  const sequence = useRef(0);
  const [snapshot, setSnapshot] = useState<OutlineSnapshot>({ key: null, entries: [] });

  useLayoutEffect(() => {
    const root = scrollRoot.current;
    if (!pageKey || !root) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const workspace = root.querySelector<HTMLElement>('.cw-workspace');
      const entries = workspace ? collectBookOutline(workspace, heading => {
        let id = identities.current.get(heading);
        if (!id) { id = `book-outline-${++sequence.current}`; identities.current.set(heading, id); }
        return id;
      }) : [];
      setSnapshot(previous => previous.key === pageKey && previous.entries.length === entries.length
        && entries.every((entry, index) => {
          const old = previous.entries[index];
          return old.id === entry.id && old.title === entry.title && old.depth === entry.depth && old.element === entry.element;
        }) ? previous : { key: pageKey, entries });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    // Editors and read-only Markdown mount asynchronously; character edits can
    // precede autosave. Attribute observation also catches source/view switches.
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'data-source-mode', 'open'] });
    update();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [pageKey, scrollRoot]);

  // ChapterWorkspace remounts on navigation. Never expose the old chapter's
  // element references during the render before the new observer is installed.
  return snapshot.key === pageKey ? snapshot : { key: pageKey, entries: [] };
}
