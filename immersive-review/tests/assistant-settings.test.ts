import { describe, expect, it } from 'vitest';
import { assistantModelValidationError } from '../src/notebook/AssistantSettings';

describe('AI settings model validation', () => {
  it('allows removing a saved credential and its model list together', () => {
    expect(assistantModelValidationError({ hasApiKey: true }, { apiKey: '', clearApiKey: true }, [])).toBe('');
  });

  it('allows an unconfigured service to keep an empty model list', () => {
    expect(assistantModelValidationError({ hasApiKey: false }, { apiKey: '  ', clearApiKey: false }, [])).toBe('');
  });

  it('still requires models when an existing credential is retained or a new one is entered', () => {
    expect(assistantModelValidationError({ hasApiKey: true }, { apiKey: '', clearApiKey: false }, [])).toBe('请至少填写一个模型 ID。');
    expect(assistantModelValidationError({ hasApiKey: false }, { apiKey: 'test-placeholder', clearApiKey: false }, [])).toBe('请至少填写一个模型 ID。');
  });

  it('accepts a configured model with either a retained or newly entered credential', () => {
    expect(assistantModelValidationError({ hasApiKey: true }, { apiKey: '', clearApiKey: false }, ['model'])).toBe('');
    expect(assistantModelValidationError({ hasApiKey: false }, { apiKey: 'test-placeholder', clearApiKey: false }, ['model'])).toBe('');
  });
});
