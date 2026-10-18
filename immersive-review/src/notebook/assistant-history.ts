import type { ApiMessage, AssistantProviderId } from './assistant-client';

export type AssistantAttachment = { title: string; content: string };
export type AssistantTurn = {
  id: string; question: string; requestContent: string; answer: string;
  providerId: AssistantProviderId; model: string;
  status: 'streaming' | 'complete' | 'stopped' | 'error'; error?: string; attachment?: AssistantAttachment;
};
export type AssistantConversation = {
  id: string; title: string; createdAt: number; updatedAt: number;
  turns: AssistantTurn[]; draft: string; attachment?: AssistantAttachment;
};
export type AssistantHistory = { version: 2; activeId: string; conversations: AssistantConversation[] };
export type AssistantResponseStyle = 'concise' | 'essence' | 'normal' | 'detailed';
export const RESPONSE_STYLES: { id: AssistantResponseStyle; label: string; instruction: string }[] = [
  { id: 'concise', label: '极简', instruction: '回答风格：极简。直接给出结论，通常不超过三句；只保留理解或执行所必需的信息。' },
  { id: 'essence', label: '直说本质', instruction: '回答风格：直说本质。先用一句话说明核心机制或根本原因，再解释关键因果和约束；省略铺垫、套话和无关扩展。' },
  { id: 'normal', label: '正常', instruction: '回答风格：正常。先回答问题，提供足够的解释和必要示例；清楚、适度，不重复。' },
  { id: 'detailed', label: '详细解读', instruction: '回答风格：详细解读。解释背景、概念、推理步骤和适用边界，必要时给出具体示例；按主题组织，避免重复。' },
];
export const ASSISTANT_HISTORY_KEY = 'read-assistant-conversations-v2';
export const LEGACY_ASSISTANT_HISTORY_KEY = 'read-assistant-chat-v1';

type ReadStorage = Pick<Storage, 'getItem'>;
type WriteStorage = Pick<Storage, 'setItem'>;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
function attachment(value: unknown): AssistantAttachment | undefined {
  return object(value) && typeof value.title === 'string' && typeof value.content === 'string'
    ? { title: value.title, content: value.content } : undefined;
}
function turns(value: unknown): AssistantTurn[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!object(item) || typeof item.id !== 'string' || typeof item.question !== 'string'
      || typeof item.requestContent !== 'string' || typeof item.answer !== 'string' || typeof item.model !== 'string'
      || !['deepseek', 'glm', 'custom'].includes(String(item.providerId))
      || !['streaming', 'complete', 'stopped', 'error'].includes(String(item.status))) return [];
    return [{ id: item.id, question: item.question, requestContent: item.requestContent, answer: item.answer,
      model: item.model, providerId: item.providerId as AssistantProviderId,
      status: (item.status === 'streaming' ? 'stopped' : item.status) as AssistantTurn['status'],
      error: typeof item.error === 'string' ? item.error : undefined, attachment: attachment(item.attachment) }];
  });
}
export function newAssistantConversation(now = Date.now(), id: string = crypto.randomUUID()): AssistantConversation {
  return { id, title: '新对话', createdAt: now, updatedAt: now, turns: [], draft: '' };
}
export function conversationTitle(question: string) {
  return question.replace(/\s+/g, ' ').trim().slice(0, 48) || '新对话';
}
export function loadAssistantHistory(local: ReadStorage, legacy?: ReadStorage): { history: AssistantHistory; error: string; migrated: boolean } {
  const fresh = newAssistantConversation();
  const empty: AssistantHistory = { version: 2, activeId: fresh.id, conversations: [fresh] };
  try {
    const raw = local.getItem(ASSISTANT_HISTORY_KEY);
    if (raw) {
      const data: unknown = JSON.parse(raw);
      if (!object(data) || data.version !== 2 || !Array.isArray(data.conversations)) throw new Error('invalid history');
      const conversations = data.conversations.flatMap(item => {
        if (!object(item) || typeof item.id !== 'string' || typeof item.title !== 'string'
          || typeof item.createdAt !== 'number' || !Number.isFinite(item.createdAt)
          || typeof item.updatedAt !== 'number' || !Number.isFinite(item.updatedAt) || !Array.isArray(item.turns)) return [];
        return [{ id: item.id, title: item.title, createdAt: item.createdAt, updatedAt: item.updatedAt,
          turns: turns(item.turns), draft: typeof item.draft === 'string' ? item.draft : '', attachment: attachment(item.attachment) }];
      });
      const unique = conversations.filter((item, index) => conversations.findIndex(other => other.id === item.id) === index);
      if (!unique.length && data.conversations.length) throw new Error('invalid history');
      return { history: unique.length ? { version: 2, activeId: unique.some(item => item.id === data.activeId) ? String(data.activeId) : unique[0].id, conversations: unique } : empty,
        error: '', migrated: false };
    }
    const old = legacy?.getItem(LEGACY_ASSISTANT_HISTORY_KEY);
    const previous = old ? turns(JSON.parse(old)) : [];
    if (previous.length) {
      fresh.turns = previous; fresh.title = conversationTitle(previous[0].question);
      return { history: empty, error: '', migrated: true };
    }
    return { history: empty, error: '', migrated: false };
  } catch {
    return { history: empty, error: '无法读取本机对话记录，已有存储未被覆盖。', migrated: false };
  }
}
export function saveAssistantHistory(storage: WriteStorage, history: AssistantHistory): string {
  try { storage.setItem(ASSISTANT_HISTORY_KEY, JSON.stringify(history)); return ''; }
  catch { return '对话未能保存到本机，请释放浏览器存储空间；当前对话仍可继续。'; }
}

/** Retain every turn locally; bound only the context sent for this request. */
export function assistantRequestMessages(history: AssistantTurn[], request: string): { messages: ApiMessage[]; omitted: number } {
  const eligible = history.filter(item => item.answer.trim());
  const pairs: ApiMessage[][] = [];
  let characters = request.length;
  let bytes = new TextEncoder().encode(JSON.stringify([{ role: 'user', content: request }])).length;
  for (let index = eligible.length - 1; index >= 0 && pairs.length < 29; index--) {
    const turn = eligible[index];
    const answer = turn.status === 'complete' ? turn.answer : `${turn.answer}\n\n[本次回答在完成前中断]`;
    const pair: ApiMessage[] = [{ role: 'user', content: turn.requestContent }, { role: 'assistant', content: answer }];
    const nextBytes = new TextEncoder().encode(JSON.stringify(pair)).length;
    if (turn.requestContent.length > 100_000 || answer.length > 100_000
      || characters + turn.requestContent.length + answer.length > 390_000 || bytes + nextBytes > 950_000) break;
    pairs.unshift(pair); characters += turn.requestContent.length + answer.length; bytes += nextBytes;
  }
  return { messages: [...pairs.flat(), { role: 'user', content: request }], omitted: eligible.length - pairs.length };
}
export function assistantRequestContent(question: string, style: AssistantResponseStyle, source?: AssistantAttachment) {
  const instruction = RESPONSE_STYLES.find(item => item.id === style)?.instruction ?? RESPONSE_STYLES[2].instruction;
  return `${instruction}\n\n${source ? `参考内容（${source.title}）：\n<reference>\n${source.content}\n</reference>\n\n` : ''}我的问题：\n${question}`;
}

export function clampAssistantWidth(width: number, viewport = 1440) {
  // Reserve the 244px navigation rail and at least 356px for reading on desktop.
  return Math.round(Math.min(Math.max(320, viewport - 600), 720, Math.max(320, Number.isFinite(width) ? width : 400)));
}
