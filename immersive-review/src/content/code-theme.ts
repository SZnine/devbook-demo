import type { ExpressiveCodeTheme } from 'expressive-code';
import './code-theme.css';

export const codeThemeName = 'catppuccin-latte';
export const darkCodeThemeName = 'github-dark';
export const codeSurface = { background: '#eff1f5', foreground: '#4c4f69', border: '#dce0e8', header: '#e6e9ef' };
export const darkCodeSurface = { background: '#141517', foreground: '#e6e6e6', border: '#373a40', header: '#1a1b1e' };

// Catppuccin Latte after Expressive Code's 5.5:1 contrast correction.
// Live editing colors native text ranges; it must not inject token spans.
export const codeTokenColors = {
  keyword: '#7b34d9', string: '#2c6e1e', number: '#a54107',
  comment: '#5d5f6e', title: '#1a57d1', variable: '#c00e34',
};

const themePromises = new Map<string, Promise<ExpressiveCodeTheme>>();
export function loadCodeTheme(mode: 'light' | 'dark' = 'light') {
  const name = mode === 'dark' ? darkCodeThemeName : codeThemeName;
  const cached = themePromises.get(name);
  if (cached) return cached;
  const promise = import('expressive-code').then(async ({ loadShikiTheme }) => {
    const theme = await loadShikiTheme(name);
    if (mode === 'dark') {
      theme.bg = theme.colors['editor.background'] = darkCodeSurface.background;
      theme.fg = theme.colors['editor.foreground'] = darkCodeSurface.foreground;
    }
    return theme.ensureMinSyntaxHighlightingColorContrast(5.5);
  }).catch(error => { themePromises.delete(name); throw error; });
  themePromises.set(name, promise);
  return promise;
}
