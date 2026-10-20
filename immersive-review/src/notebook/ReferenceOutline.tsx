import { t } from '../i18n';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { Icon } from '../manual-demo/icons';

export type OutlineEntry = { id: string; title: string; depth?: number; element?: HTMLElement };

type ReferenceOutlineProps = {
  open: boolean;
  title: string;
  entries: OutlineEntry[];
  emptyText?: string;
  scrollRoot: RefObject<HTMLElement | null>;
  onOpen: () => void;
  onClose: () => void;
};

const READING_OFFSET = 76;

export function ReferenceOutline({ open, title, entries, emptyText, scrollRoot, onOpen, onClose }: ReferenceOutlineProps) {
  const [currentSection, setCurrentSection] = useState<string | null>(null);
  const [marker, setMarker] = useState({ top: 0, height: 18 });
  const list = useRef<HTMLElement>(null);
  const firstLink = useRef<HTMLButtonElement>(null);
  const visibleIds = entries.map(entry => entry.id);
  const firstLevel = entries.length ? Math.min(...entries.map(entry => entry.depth ?? 0)) : 0;
  const selectedSection = currentSection && visibleIds.includes(currentSection) ? currentSection : visibleIds[0];

  useEffect(() => {
    const root = scrollRoot.current;
    if (!root) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const sections = entries.map(entry => ({ entry, element: entry.element ?? document.getElementById(entry.id) })).filter((item): item is { entry: OutlineEntry; element: HTMLElement } => Boolean(item.element && root.contains(item.element)));
      if (!sections.length) { setCurrentSection(null); return; }
      const readingLine = root.getBoundingClientRect().top + READING_OFFSET + 8;
      let current = sections[0];
      for (const section of sections) {
        if (section.element.getBoundingClientRect().top > readingLine) break;
        current = section;
      }
      if (root.scrollHeight > root.clientHeight && root.scrollTop + root.clientHeight >= root.scrollHeight - 2) current = sections[sections.length - 1];
      setCurrentSection(current.entry.id);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    root.addEventListener('scroll', schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    const reader = root.querySelector('.nb-reader, .cw-workspace');
    if (reader) observer.observe(reader);
    schedule();
    return () => { root.removeEventListener('scroll', schedule); observer.disconnect(); cancelAnimationFrame(frame); };
  }, [entries, scrollRoot]);

  useEffect(() => {
    if (!open) return;
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
  }, [open, selectedSection, entries]);

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
    const entry = entries.find(item => item.id === id);
    const section = entry?.element ?? document.getElementById(id);
    if (!root || !section || !root.contains(section)) return;
    root.scrollTo({
      top: Math.max(0, root.scrollTop + section.getBoundingClientRect().top - root.getBoundingClientRect().top - READING_OFFSET),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
    // On a compact desktop window the directory overlays reading, so release it
    // after choosing a destination. Wide layouts keep their dedicated gutter.
    if (window.matchMedia('(max-width: 1239px)').matches) onClose();
  };

  return <aside className={`nb-reference-outline ${open ? 'is-open' : ''}`} aria-label={t('本章目录', 'On this page')} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
  }}>
    <button type="button" className="nro-rail" aria-label={t('打开本章目录', 'Open outline')} title={t('本章目录', 'On this page')} aria-expanded={open} aria-controls="reference-outline" tabIndex={open ? -1 : 0} aria-hidden={open || undefined} onClick={() => { onOpen(); requestAnimationFrame(() => firstLink.current?.focus({ preventScroll: true })); }}>
      <Icon name="list" />
      <span className="nro-rail-lines" aria-hidden="true">{visibleIds.slice(0, 20).map(id => <i key={id} className={selectedSection === id ? 'is-current' : ''} />)}</span>
    </button>
    <div id="reference-outline" className="nro-drawer" inert={!open} aria-hidden={!open}>
      <header className="nro-header"><span><Icon name="list" /><strong>{t('本章目录', 'On this page')}</strong></span><button type="button" className="nro-close" aria-label={t('收起目录', 'Close outline')} title={t('收起目录', 'Close outline')} onClick={onClose}><Icon name="chevron" /></button></header>
      <p className="nro-context">{title}</p>
      <nav className="nro-list" ref={list} aria-label={t('本章小节', 'Sections')}>
        <div className="nro-links">
          {visibleIds.length > 0 && <span className="nro-marker" aria-hidden="true" style={{ top: marker.top, height: marker.height }} />}
          {entries.length ? entries.map(({ id, title: label, depth = 0 }, index) => <button ref={index === 0 ? firstLink : undefined} type="button" className="nro-row" key={id} aria-current={selectedSection === id ? 'location' : undefined} onClick={() => jumpToSection(id)} title={label} style={{ paddingLeft: 16 + Math.min(depth - firstLevel, 5) * 12 }}>
            <span className="nro-label">{label}</span>
          </button>) : <p className="nro-empty">{emptyText ?? t('没有匹配的小节', 'No matching sections')}</p>}
        </div>
      </nav>
    </div>
  </aside>;
}
