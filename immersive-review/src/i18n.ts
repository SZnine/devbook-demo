import { useSyncExternalStore } from 'react';

export type Language = 'en' | 'zh-CN';
export const LANGUAGE_KEY = 'read-language';
const listeners = new Set<() => void>();
let currentLanguage: Language = readLanguage();

function readLanguage(): Language {
  try { return localStorage.getItem(LANGUAGE_KEY) === 'zh-CN' ? 'zh-CN' : 'en'; }
  catch { return 'en'; }
}

export function getLanguage(): Language { return currentLanguage; }
export function t(zh: string, en: string): string { return currentLanguage === 'zh-CN' ? zh : en; }
export function dateLocale(): string { return currentLanguage === 'zh-CN' ? 'zh-CN' : 'en-US'; }

function applyLanguage() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = currentLanguage;
  document.title = t('Read · 随笔、阅读与记忆', 'Read · Notes, reading & memory');
}

export function setLanguage(language: Language) {
  if (language !== 'en' && language !== 'zh-CN') return;
  try { localStorage.setItem(LANGUAGE_KEY, language); } catch { /* The session preference still applies. */ }
  if (currentLanguage === language) return;
  currentLanguage = language;
  applyLanguage();
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useLanguage() {
  const language = useSyncExternalStore(subscribe, getLanguage, () => 'en' as Language);
  return { language, setLanguage };
}

if (typeof window !== 'undefined') {
  applyLanguage();
  window.addEventListener('storage', event => {
    if (event.key !== LANGUAGE_KEY && event.key !== null) return;
    const language = readLanguage();
    if (language === currentLanguage) return;
    currentLanguage = language;
    applyLanguage();
    listeners.forEach(listener => listener());
  });
}
