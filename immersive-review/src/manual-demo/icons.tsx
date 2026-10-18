import type { ReactNode } from 'react';
import { UnitIcon } from './UnitIcon';
export type IconName = 'book' | 'search' | 'sidebar' | 'plus' | 'settings' | 'chevron' | 'experiment' | 'note' | 'link' | 'background' | 'import' | 'organize' | 'memory' | 'history' | 'optimize' | 'list' | 'code' | 'eye' | 'trash' | 'copy' | 'archive';
export function Icon({ name }: { name: IconName }) {
  if (name === 'memory') return <UnitIcon name="head-memory" />;
  if (name === 'history' || name === 'optimize') return <UnitIcon name={name} />;
  const paths: Partial<Record<IconName, ReactNode>> = {
    archive: <><rect x="3" y="3" width="18" height="4" rx="1" /><path d="M5 7v13h14V7M9 11h6" /></>,
    trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></>,
    copy: <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V3H3v13h5" /></>,
    book: <path d="M12 5v15M3 4.5c3-1 6-.5 9 1.5 3-2 6-2.5 9-1.5v15c-3-1-6-.5-9 1.5-3-2-6-2.5-9-1.5z" />,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    sidebar: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    settings: <><path d="M4 7h16M4 17h16" /><rect x="7" y="4" width="4" height="6" rx="2" fill="currentColor" stroke="none" /><rect x="14" y="14" width="4" height="6" rx="2" fill="currentColor" stroke="none" /></>,
    chevron: <path d="m9 5 7 7-7 7" />,
    experiment: <><path d="M9 3h6M10 3v6l-6 10a1.3 1.3 0 0 0 1 2h14a1.3 1.3 0 0 0 1-2L14 9V3M7.5 15h9" /></>,
    note: <><path d="M12 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7M16 3l5 5M9 15l1-5L18 2l5 5-8 8z" /></>,
    list: <><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></>,
    code: <><path d="m8 5-6 7 6 7m8-14 6 7-6 7M14 3l-4 18" /></>,
    eye: <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12" /><circle cx="12" cy="12" r="3" /></>,
    link: <path d="m10 14 4-4M8 16l-1 1a3.5 3.5 0 0 1-5-5l5-5a3.5 3.5 0 0 1 5 0M16 8l1-1a3.5 3.5 0 0 1 5 5l-5 5a3.5 3.5 0 0 1-5 0" />,
    background: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    import: <path d="M4 14v6h16v-6M12 3v12m-4-4 4 4 4-4" />,
    organize: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><path d="M17.5 14v7M14 17.5h7" /></>,
  };
  return <svg data-icon={name} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
