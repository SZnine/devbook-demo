import type { ReactNode } from 'react';

export type UnitIconName = 'head-memory' | 'history' | 'optimize';
export function UnitIcon({ name }: { name: UnitIconName }) {
  const paths: Record<UnitIconName, ReactNode> = {
    // Lucide originals; licenses (ISC and Feather MIT): /licenses/lucide-LICENSE.txt.
    history: <><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l4 2" /></>,
    optimize: <><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72" /><path d="m14 7 3 3M5 6v4M19 14v4M10 2v2M7 8H3M21 16h-4M11 3H9" /></>,
    // Google Material Symbols Outlined: psychology. Original path, adapted to the shared React icon wrapper.
    'head-memory': <path d="M240-80v-172q-57-52-88.5-121.5T120-520q0-150 105-255t255-105q125 0 221.5 73.5T827-615l52 205q5 19-7 34.5T840-360h-80v120q0 33-23.5 56.5T680-160h-80v80h-80v-160h160v-200h108l-38-155q-23-91-98-148t-172-57q-116 0-198 81t-82 197q0 60 24.5 114t69.5 96l26 24v208h-80Zm254-360Zm-54 80h80l6-50q8-3 14.5-7t11.5-9l46 20 40-68-40-30q2-8 2-16t-2-16l40-30-40-68-46 20q-5-5-11.5-9t-14.5-7l-6-50h-80l-6 50q-8 3-14.5 7t-11.5 9l-46-20-40 68 40 30q-2 8-2 16t2 16l-40 30 40 68 46-20q5 5 11.5 9t14.5 7l6 50Zm40-100q-25 0-42.5-17.5T420-520q0-25 17.5-42.5T480-580q25 0 42.5 17.5T540-520q0 25-17.5 42.5T480-460Z" />,
  };
  const isHead = name === 'head-memory';
  return <svg className="unit-icon" data-icon={name} viewBox={isHead ? '0 -960 960 960' : '0 0 24 24'} fill={isHead ? 'currentColor' : 'none'} stroke={isHead ? 'none' : 'currentColor'} strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}

/*!
 * Psychology icon: Google Material Symbols, Apache License 2.0.
 * Source: https://github.com/google/material-design-icons/blob/master/symbols/web/psychology/materialsymbolsoutlined/psychology_24px.svg
 * License copy: /licenses/material-symbols-Apache-2.0.txt
 * Changes: SVG attributes integrated into this React wrapper; path unchanged.
 */
