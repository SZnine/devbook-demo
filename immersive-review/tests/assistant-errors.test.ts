import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../src/i18n';
import { assistantErrorMessage } from '../src/notebook/assistant-errors';

afterEach(() => setLanguage('en'));

describe('assistant error localization', () => {
  it('translates known server errors and preserves the original Chinese option', () => {
    setLanguage('en');
    expect(assistantErrorMessage('API 认证失败，请检查该服务的 API Key 和访问权限。')).toBe('Authentication failed. Check the API key and permissions.');
    expect(assistantErrorMessage('AI 服务暂时无法响应（503），请稍后重试。')).toBe('Provider unavailable (503). Try again.');
    setLanguage('zh-CN');
    expect(assistantErrorMessage('API 认证失败，请检查该服务的 API Key 和访问权限。')).toBe('API 认证失败，请检查该服务的 API Key 和访问权限。');
  });

  it('does not rewrite arbitrary upstream messages or embedded user content', () => {
    setLanguage('en');
    const upstream = '服务商提示：此模型暂未开放';
    expect(assistantErrorMessage(upstream)).toBe(upstream);
    const quoted = '引用：API 认证失败，请检查该服务的 API Key 和访问权限。';
    expect(assistantErrorMessage(quoted)).toBe(quoted);
  });
});
