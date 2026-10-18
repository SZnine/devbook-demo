import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('MODE', 'demo');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('public demo privacy boundary', () => {
  it('does not fetch provider config, submit credentials, chat, or score content', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const { getAssistantConfig, saveAssistantConfig, streamAssistantReply } = await import('../src/notebook/assistant-client');
    const { assessMemoryPriority } = await import('../src/notebook/memory-priority-client');
    expect(await getAssistantConfig()).toEqual({ providers: [] });
    await expect(saveAssistantConfig({ providerId: 'custom', baseUrl: 'https://example.test/v1', models: ['demo'], apiKey: 'not-a-real-key' })).rejects.toThrow('在线演示不连接 AI 服务');
    const onDelta = vi.fn();
    await expect(streamAssistantReply({ providerId: 'custom', model: 'demo', messages: [{ role: 'user', content: 'private note' }] }, { onDelta })).rejects.toThrow('在线演示不连接 AI 服务');
    await expect(assessMemoryPriority({ providerId: 'custom', model: 'demo', goal: '', items: [] })).rejects.toThrow('在线演示不连接 AI 服务');
    expect(fetcher).not.toHaveBeenCalled();
    expect(onDelta).not.toHaveBeenCalled();
  });
});
