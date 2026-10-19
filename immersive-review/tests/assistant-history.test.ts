import { setLanguage } from '../src/i18n';
import { beforeEach, describe, expect, it } from 'vitest';
import { ASSISTANT_HISTORY_KEY, LEGACY_ASSISTANT_HISTORY_KEY, assistantRequestContent, assistantRequestMessages, clampAssistantWidth,
  loadAssistantHistory, newAssistantConversation, saveAssistantHistory, type AssistantHistory, type AssistantTurn } from '../src/notebook/assistant-history';

function storage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}
function turn(id: string, patch: Partial<AssistantTurn> = {}): AssistantTurn {
  return { id, question: `问题 ${id}`, requestContent: `问题 ${id}`, answer: `回答 ${id}`, providerId: 'deepseek', model: 'deepseek-chat', status: 'complete', ...patch };
}

beforeEach(() => setLanguage('zh-CN'));

describe('assistant persistent conversations', () => {
  it('migrates the old session without deleting it, preserving interrupted replies and quote snapshots', () => {
    const source = { title: '字典', content: '```py\nprint(1)\n```' };
    const legacy = storage({ [LEGACY_ASSISTANT_HISTORY_KEY]: JSON.stringify([turn('a'), turn('b', { status: 'streaming', attachment: source })]) });
    const local = storage();
    const loaded = loadAssistantHistory(local, legacy);
    expect(loaded.migrated).toBe(true);
    expect(loaded.history.conversations[0].turns[1]).toMatchObject({ status: 'stopped', attachment: source });
    expect(saveAssistantHistory(local, loaded.history)).toBe('');
    expect(loadAssistantHistory(local, legacy).migrated).toBe(false);
    expect(legacy.getItem(LEGACY_ASSISTANT_HISTORY_KEY)).not.toBeNull();
  });

  it('round-trips independent conversations, drafts, active conversation and all rounds', () => {
    const first = { ...newAssistantConversation(1, 'first'), title: '第一个问题', turns: [turn('first')], draft: '继续追问', attachment: { title: '选区', content: '上下文' } };
    const second = { ...newAssistantConversation(2, 'second'), title: '另一个问题', turns: Array.from({ length: 45 }, (_, i) => turn(String(i))) };
    const history: AssistantHistory = { version: 2, activeId: first.id, conversations: [second, first] };
    const local = storage();
    expect(saveAssistantHistory(local, history)).toBe('');
    const restored = loadAssistantHistory(local).history;
    expect(restored).toEqual(history);
    expect(restored.conversations[0].turns).toHaveLength(45);
  });

  it('does not write over unreadable history and reports blocked storage', () => {
    const local = storage({ [ASSISTANT_HISTORY_KEY]: '{invalid' });
    const loaded = loadAssistantHistory(local);
    expect(loaded.error).toContain('未被覆盖');
    expect(local.getItem(ASSISTANT_HISTORY_KEY)).toBe('{invalid');
    expect(saveAssistantHistory({ setItem: () => { throw new Error('QuotaExceededError'); } }, loaded.history)).toContain('未能保存');
  });

  it('discards unknown keys when loading and recovers an invalid active ID', () => {
    const local = storage({ [ASSISTANT_HISTORY_KEY]: JSON.stringify({ version: 2, activeId: 'missing', conversations: [
      { ...newAssistantConversation(1, 'actual'), apiKey: 'not-a-real-key', turns: [{ ...turn('a'), token: 'unexpected' }, { invalid: true }] },
    ] }) });
    const loaded = loadAssistantHistory(local);
    expect(loaded.history.activeId).toBe('actual');
    expect(JSON.stringify(loaded.history)).not.toContain('not-a-real-key');
    expect(loaded.history.conversations[0].turns).toHaveLength(1);
    expect(JSON.stringify(loaded.history)).not.toContain('unexpected');
  });
});

describe('continuous request context and style', () => {
  it('sends the latest rounds within API limits without erasing older local history', () => {
    const turns = Array.from({ length: 45 }, (_, i) => turn(String(i)));
    const original = JSON.stringify(turns);
    const result = assistantRequestMessages(turns, '新的问题');
    expect(result.messages).toHaveLength(59);
    expect(result.omitted).toBe(16);
    expect(result.messages[0].content).toBe('问题 16');
    expect(result.messages.at(-1)).toEqual({ role: 'user', content: '新的问题' });
    expect(JSON.stringify(turns)).toBe(original);
  });

  it('preserves reference Markdown and marks partial answers when continuing', () => {
    const question = assistantRequestContent('为什么？', 'essence', { title: '代码', content: '```py\nprint(1)\n```' });
    expect(question).toContain('回答风格：直说本质');
    expect(question).toContain('```py\nprint(1)\n```');
    const result = assistantRequestMessages([turn('a', { status: 'stopped' }), turn('error', { status: 'error', answer: '' })], question);
    expect(result.messages).toHaveLength(3);
    expect(result.messages[1].content).toContain('完成前中断');
    expect(assistantRequestContent('说明', 'concise')).toContain('通常不超过三句');
    expect(assistantRequestContent('说明', 'normal')).toContain('回答风格：正常');
    expect(assistantRequestContent('说明', 'detailed')).toContain('适用边界');
  });

  it('bounds UTF-8 payloads and never splits user/assistant pairs', () => {
    const turns = Array.from({ length: 8 }, (_, i) => turn(String(i), { requestContent: '汉'.repeat(60_000), answer: '字'.repeat(60_000) }));
    const { messages, omitted } = assistantRequestMessages(turns, '继续');
    expect(messages.length % 2).toBe(1);
    expect(new TextEncoder().encode(JSON.stringify(messages)).length).toBeLessThan(950_000);
    expect(omitted).toBeGreaterThan(0);
  });

  it('clamps drag and keyboard widths to usable pane bounds', () => {
    expect(clampAssistantWidth(100)).toBe(320);
    expect(clampAssistantWidth(900)).toBe(720);
    expect(clampAssistantWidth(720, 1000)).toBe(400);
    expect(clampAssistantWidth(504, 984)).toBe(384);
    expect(clampAssistantWidth(720, 1280)).toBe(680);
    expect(clampAssistantWidth(Number.NaN)).toBe(400);
  });
});
