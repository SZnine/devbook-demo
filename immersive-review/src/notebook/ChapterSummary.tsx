import { t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { ChapterEditor } from './ChapterEditor';
import { Markdown } from '../Markdown';
import type { Collection } from './store';

type Props = {
  chapter: Collection;
  isBook: boolean;
  readOnly: boolean;
  mode: 'ir' | 'sv';
  onFocus: () => void;
  commit: (id: string, summary: string) => Promise<Collection>;
};

// The overview belongs to the chapter, not to its ordered notes or memory entries.
export function ChapterSummary({ chapter, isBook, readOnly, mode, onFocus, commit }: Props) {
  const key = `read-chapter-summary:${chapter.id}`;
  const [text, setText] = useState(() => sessionStorage.getItem(key) ?? chapter.summary ?? '');
  const textRef = useRef(text);
  const saved = useRef(chapter.summary ?? '');
  const dirty = useRef(text !== saved.current);
  useEffect(() => {
    saved.current = chapter.summary ?? '';
    if (!dirty.current) { textRef.current = saved.current; setText(saved.current); }
  }, [chapter.summary]);

  const change = (markdown: string) => {
    textRef.current = markdown;
    dirty.current = markdown !== saved.current;
    sessionStorage.setItem(key, markdown);
    setText(markdown);
  };
  const save = async (markdown: string) => {
    const result = await commit(chapter.id, markdown);
    saved.current = result.summary ?? '';
    if (textRef.current === markdown) {
      dirty.current = false;
      if (sessionStorage.getItem(key) === markdown) sessionStorage.removeItem(key);
    }
    return true;
  };

  if (readOnly && !chapter.summary) return null;
  return <section data-ai-owner={chapter.id} className={`cw-summary ${text.trim() ? '' : 'is-empty'}`} aria-label={isBook ? t("书籍摘要", "Book summary") : t("章节摘要", "Chapter summary")}>
    {readOnly ? <div className="cw-prose"><Markdown body={chapter.summary ?? ''} /></div>
      : <ChapterEditor value={text} mode={mode} live allowEmpty autoFocus={false}
        initiallyDirty={text !== (chapter.summary ?? '')} label={isBook ? t("书籍摘要", "Book summary") : t("章节摘要", "Chapter summary")}
        placeholder={isBook ? t("添加书籍摘要…", "Add a book summary…") : t("添加章节摘要…", "Add a chapter summary…")}
        onFocus={onFocus} onChange={change} onCommit={save} onSave={() => save(textRef.current)} onCancel={() => {}} />}
  </section>;
}
