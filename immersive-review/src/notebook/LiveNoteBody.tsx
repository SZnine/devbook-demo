import { t } from '../i18n';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChapterEditor } from './ChapterEditor';
import type { Note } from './store';

type Props = {
  note: Note;
  collectionId: string;
  mode: 'ir' | 'sv';
  onFocus: () => void;
  commit: (input: { id?: string; markdown: string; collectionId?: string }) => Promise<Note>;
};

// Reading content autosaves in its owning chapter; legacy shared memos
// are copied by the store before the first book edit.
export function LiveNoteBody({ note, collectionId, mode, onFocus, commit }: Props) {
  // A legacy note may appear in multiple chapters. Never replay one chapter's
  // unfinished edit in another chapter before copy-on-write has completed.
  const key = `read-live-note:${collectionId}:${note.id}`;
  const originKey = `read-live-note:${collectionId}:${note.editingOriginId ?? note.id}`;
  const storageKey = useRef(sessionStorage.getItem(key) !== null ? key : originKey);
  const [text, setText] = useState(() => sessionStorage.getItem(storageKey.current) ?? note.markdown);
  const textRef = useRef(text);
  const dirty = useRef(text !== note.markdown);
  const saved = useRef(note.markdown);
  useLayoutEffect(() => {
    // Copy-on-write changes the persisted id, not this editing session. Move
    // only its recovery draft; do not reset the text or the native undo stack.
    // Using the current id also survives subsequent copy-on-write generations.
    const previous = storageKey.current;
    if (previous === key) return;
    if (dirty.current) sessionStorage.setItem(key, textRef.current);
    sessionStorage.removeItem(previous);
    storageKey.current = key;
  }, [key]);
  useEffect(() => {
    saved.current = note.markdown;
    if (!dirty.current) { textRef.current = note.markdown; setText(note.markdown); }
  }, [note.markdown]);

  const change = (markdown: string) => {
    textRef.current = markdown;
    dirty.current = markdown !== saved.current;
    sessionStorage.setItem(storageKey.current, markdown);
    setText(markdown);
  };
  const save = async (markdown: string) => {
    // The editor may be undoing to this value while a newer save is queued.
    // Every requested snapshot must retain its place in the store queue.
    const submittedKey = storageKey.current;
    const result = await commit({ id: note.id, collectionId, markdown });
    saved.current = result.markdown;
    if (textRef.current === markdown) {
      dirty.current = false;
      for (const savedKey of new Set([submittedKey, storageKey.current])) {
        if (sessionStorage.getItem(savedKey) === markdown) sessionStorage.removeItem(savedKey);
      }
    }
    return true;
  };
  return <div data-reading-core data-reading-dirty={mode === 'sv' || text !== note.markdown}><ChapterEditor value={text} mode={mode} live allowEmpty initiallyDirty={text !== note.markdown} onFocus={onFocus} onChange={change} onCommit={save} onSave={() => save(textRef.current)} onCancel={() => {}} autoFocus={false} label={`${t("正文", "Content")}: ${note.markdown.split('\n').find(line => line.trim())?.replace(/^#+\s*/, '').slice(0, 60) || t("正文", "Content")}`} /></div>;
}
