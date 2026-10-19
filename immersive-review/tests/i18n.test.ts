import { afterEach, describe, expect, it, vi } from 'vitest';

function browser(saved?: string) {
  const data = new Map(saved === undefined ? [] : [['read-language', saved]]);
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  const window = new EventTarget();
  const document = { documentElement: { lang: '' }, title: '' };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  return { storage, window, document };
}

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('product language', () => {
  it('starts in English independently of the browser language', async () => {
    const { document } = browser();
    vi.stubGlobal('navigator', { language: 'zh-CN' });
    const locale = await import('../src/i18n');
    expect(locale.getLanguage()).toBe('en');
    expect(locale.t('设置', 'Settings')).toBe('Settings');
    expect(locale.dateLocale()).toBe('en-US');
    expect(document.documentElement.lang).toBe('en');
    expect(document.title).toBe('Read · Notes, reading & memory');
  });

  it('persists a language change and restores it on reload', async () => {
    const { storage, document } = browser();
    let locale = await import('../src/i18n');
    locale.setLanguage('zh-CN');
    expect(storage.getItem('read-language')).toBe('zh-CN');
    expect(document.documentElement.lang).toBe('zh-CN');
    vi.resetModules();
    locale = await import('../src/i18n');
    expect(locale.t('设置', 'Settings')).toBe('设置');
    locale.setLanguage('en');
    expect(locale.t('设置', 'Settings')).toBe('Settings');
  });

  it('ignores invalid stored values and works when storage is unavailable', async () => {
    browser('unsupported');
    let locale = await import('../src/i18n');
    expect(locale.getLanguage()).toBe('en');
    vi.resetModules();
    vi.stubGlobal('localStorage', { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } });
    locale = await import('../src/i18n');
    expect(() => locale.setLanguage('zh-CN')).not.toThrow();
    expect(locale.getLanguage()).toBe('zh-CN');
  });

  it('applies language changes from another tab', async () => {
    const { storage, window, document } = browser();
    const locale = await import('../src/i18n');
    storage.setItem('read-language', 'zh-CN');
    const event = new Event('storage');
    Object.defineProperty(event, 'key', { value: 'read-language' });
    window.dispatchEvent(event);
    expect(locale.getLanguage()).toBe('zh-CN');
    expect(document.documentElement.lang).toBe('zh-CN');
  });

  it('updates response menu labels without rewriting saved or attached content', async () => {
    browser();
    const locale = await import('../src/i18n');
    const { RESPONSE_STYLES, assistantRequestContent } = await import('../src/notebook/assistant-history');
    const source = { title: '我的实验', content: '```python\nprint("保持原样")\n```' };
    const original = JSON.stringify(source);
    expect(RESPONSE_STYLES[0].label).toBe('Brief');
    expect(assistantRequestContent('请解释', 'concise', source)).toContain(source.content);
    locale.setLanguage('zh-CN');
    expect(RESPONSE_STYLES[0].label).toBe('极简');
    expect(assistantRequestContent('请解释', 'concise', source)).toContain(source.content);
    expect(JSON.stringify(source)).toBe(original);
  });
});
