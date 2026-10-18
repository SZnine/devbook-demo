import { useEffect, useRef, useState, type RefObject } from 'react';
import { Icon } from '../manual-demo/icons';
import { manual, sectionMap, shortTitle } from './content';

type ReferenceOutlineProps = {
  open: boolean;
  topicId: string | null;
  sectionIds: string[];
  scrollRoot: RefObject<HTMLElement | null>;
  onOpen: () => void;
  onClose: () => void;
};

const READING_OFFSET = 76;

export function ReferenceOutline({ open, topicId, sectionIds, scrollRoot, onOpen, onClose }: ReferenceOutlineProps) {
  const [currentSection, setCurrentSection] = useState<string | null>(null);
  const [marker, setMarker] = useState({ top: 0, height: 18 });
  const list = useRef<HTMLElement>(null);
  const firstLink = useRef<HTMLButtonElement>(null);
  const topic = manual.topics.find(item => item.id === topicId);
  const visibleIds = sectionIds.filter(id => sectionMap.has(id));
  const sectionKey = visibleIds.join('|');
  const selectedSection = currentSection && visibleIds.includes(currentSection) ? currentSection : visibleIds[0];

  useEffect(() => {
    if (!topic) return;
    const root = scrollRoot.current;
    if (!root) return;
    const ids = sectionKey ? sectionKey.split('|') : [];
    let frame = 0;
    const update = () => {
      frame = 0;
      const sections = ids.map(id => document.getElementById(`source-${id}`)).filter((element): element is HTMLElement => Boolean(element && root.contains(element)));
      if (!sections.length) { setCurrentSection(null); return; }
      const readingLine = root.getBoundingClientRect().top + READING_OFFSET + 8;
      let current = sections[0];
      for (const section of sections) {
        if (section.getBoundingClientRect().top > readingLine) break;
        current = section;
      }
      if (root.scrollHeight > root.clientHeight && root.scrollTop + root.clientHeight >= root.scrollHeight - 2) current = sections[sections.length - 1];
      setCurrentSection(current.id.slice('source-'.length));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    root.addEventListener('scroll', schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    const reader = root.querySelector('.nb-reader');
    if (reader) observer.observe(reader);
    schedule();
    return () => { root.removeEventListener('scroll', schedule); observer.disconnect(); cancelAnimationFrame(frame); };
  }, [topicId, sectionKey, scrollRoot]);

  useEffect(() => {
    if (!open || !topic) return;
    const frame = requestAnimationFrame(() => {
      const container = list.current;
      const selected = container?.querySelector<HTMLElement>('[aria-current]');
      if (!container || !selected) return;
      const bounds = container.getBoundingClientRect();
      const row = selected.getBoundingClientRect();
      setMarker({ top: selected.offsetTop + 7, height: Math.max(18, selected.offsetHeight - 14) });
      if (row.top < bounds.top + 8) container.scrollTop += row.top - bounds.top - 8;
      else if (row.bottom > bounds.bottom - 8) container.scrollTop += row.bottom - bounds.bottom + 8;
    });
    return () => cancelAnimationFrame(frame);
  }, [open, topicId, selectedSection]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('[role="dialog"], dialog[open]')) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const jumpToSection = (id: string) => {
    const root = scrollRoot.current;
    const section = document.getElementById(`source-${id}`);
    if (!root || !section || !root.contains(section)) return;
    root.scrollTo({
      top: Math.max(0, root.scrollTop + section.getBoundingClientRect().top - root.getBoundingClientRect().top - READING_OFFSET),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
    // On a compact desktop window the directory overlays reading, so release it
    // after choosing a destination. Wide layouts keep their dedicated gutter.
    if (window.matchMedia('(max-width: 1239px)').matches) onClose();
  };

  if (!topic) return null;

  return <aside className={`nb-reference-outline ${open ? 'is-open' : ''}`} aria-label="本章目录" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
  }}>
    <button type="button" className="nro-rail" aria-label="打开本章目录" title="本章目录" aria-expanded={open} aria-controls="reference-outline" tabIndex={open ? -1 : 0} aria-hidden={open || undefined} onClick={() => { onOpen(); requestAnimationFrame(() => firstLink.current?.focus({ preventScroll: true })); }}>
      <Icon name="list" />
      <span className="nro-rail-lines" aria-hidden="true">{visibleIds.slice(0, 20).map(id => <i key={id} className={selectedSection === id ? 'is-current' : ''} />)}</span>
    </button>
    <div id="reference-outline" className="nro-drawer" inert={!open} aria-hidden={!open}>
      <header className="nro-header"><span><Icon name="list" /><strong>本章目录</strong></span><button type="button" className="nro-close" aria-label="收起目录" title="收起目录" onClick={onClose}><Icon name="chevron" /></button></header>
      <p className="nro-context">{topic.title}</p>
      <nav className="nro-list" ref={list} aria-label="本章小节">
        <div className="nro-links">
          {visibleIds.length > 0 && <span className="nro-marker" aria-hidden="true" style={{ top: marker.top, height: marker.height }} />}
          {visibleIds.length ? visibleIds.map((id, index) => <button ref={index === 0 ? firstLink : undefined} type="button" className="nro-row" key={id} aria-current={selectedSection === id ? 'location' : undefined} onClick={() => jumpToSection(id)} title={shortTitle(sectionMap.get(id)!.title)}>
            <span className="nro-label">{shortTitle(sectionMap.get(id)!.title)}</span>
          </button>) : <p className="nro-empty">没有匹配的小节</p>}
        </div>
      </nav>
    </div>
  </aside>;
}
