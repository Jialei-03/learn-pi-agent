// 上下文压缩（第 8 章）：历史太长时，把较早的部分换成一份结构化摘要。
// 原始记录一条都不删，只是在会话里追加一条“压缩”记录；之后构建上下文时用“摘要 + 保留的近期消息”。
// 对照 Pi：packages/coding-agent/src/core/compaction/compaction.ts、utils.ts
import type { Entry, Session } from './session.ts';
import type { Message, Model } from './types.ts';

export const DEFAULTS = { reserveTokens: 16384, keepRecentTokens: 20000 };

/** 触发条件：上下文 > 窗口 − 预留。预留给模型的回答，以及压缩本身需要的空间。 */
export function shouldCompact(contextTokens: number, contextWindow: number, reserveTokens = DEFAULTS.reserveTokens) {
  return contextTokens > contextWindow - reserveTokens;
}

/** 单条消息的估算：只数内容的字符，按 4 个字符一个 token（偏保守，宁可多估）。与 Pi 的 estimateTokens 一致。 */
export function estimateMessageTokens(m: Message): number {
  if (m.role === 'user' || m.role === 'toolResult') return Math.ceil(m.content.length / 4);
  let chars = 0;
  for (const b of m.content) chars += b.type === 'text' ? b.text.length : b.name.length + JSON.stringify(b.arguments).length;
  return Math.ceil(chars / 4);
}

export interface CutPoint { firstKeptIndex: number; isSplitTurn: boolean; turnStartIndex: number }

/**
 * 找切点：从最新的消息往回累加，直到攒够 keepRecentTokens。
 * 只能切在 user 或 assistant 消息上——绝不能切在工具结果上，否则保留部分的开头是一条“没有调用的结果”。
 * 如果切点不是 user 消息，说明一轮对话被切成了两半（split turn），前半段要单独总结。
 */
export function findCutPoint(messages: Message[], keepRecentTokens = DEFAULTS.keepRecentTokens): CutPoint {
  const cutPoints = messages.map((m, i) => (m.role === 'toolResult' ? -1 : i)).filter(i => i >= 0);
  if (cutPoints.length === 0) return { firstKeptIndex: 0, isSplitTurn: false, turnStartIndex: -1 };
  let cut = cutPoints[0];
  let accumulated = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    accumulated += estimateMessageTokens(messages[i]);
    if (accumulated >= keepRecentTokens) {
      cut = cutPoints.find(c => c >= i) ?? cutPoints[cutPoints.length - 1];
      break;
    }
  }
  const startsTurn = messages[cut].role === 'user';
  let turnStart = -1;
  if (!startsTurn) for (let i = cut; i >= 0; i--) if (messages[i].role === 'user') { turnStart = i; break; }
  return { firstKeptIndex: cut, isSplitTurn: !startsTurn && turnStart !== -1, turnStartIndex: turnStart };
}

/**
 * 把对话序列化成纯文本再交给模型总结。
 * 如果直接把消息原样发过去，模型会以为自己在对话中，接着回答最后一个问题，而不是写摘要。
 * 工具结果截断到 2000 字符：写摘要不需要完整的文件内容。
 */
export function serializeConversation(messages: Message[]): string {
  const parts: string[] = [];
  for (const m of messages) {
    if (m.role === 'user') parts.push(`[用户]：${m.content}`);
    else if (m.role === 'assistant') {
      const text = m.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('');
      const calls = m.content.filter(b => b.type === 'toolCall').map(b => `${(b as any).name}(${Object.entries((b as any).arguments).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')})`);
      if (text) parts.push(`[助手]：${text}`);
      if (calls.length) parts.push(`[助手调用工具]：${calls.join('; ')}`);
    } else {
      const text = m.content.length > 2000 ? `${m.content.slice(0, 2000)}\n\n[……还有 ${m.content.length - 2000} 个字符被截断]` : m.content;
      parts.push(`[工具结果]：${text}`);
    }
  }
  return parts.join('\n\n');
}

/** 记录读过、改过哪些文件。摘要可能漏掉细节，但“改过哪些文件”这种事实必须保留，而且要跨多次压缩累积。 */
export function fileOperations(messages: Message[], previous?: { read: string[]; modified: string[] }) {
  const read = new Set(previous?.read ?? []);
  const modified = new Set(previous?.modified ?? []);
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    for (const b of m.content) {
      if (b.type !== 'toolCall' || typeof b.arguments.path !== 'string') continue;
      if (b.name === 'read') read.add(b.arguments.path);
      if (b.name === 'edit' || b.name === 'write') modified.add(b.arguments.path);
    }
  }
  return { read: [...read].filter(f => !modified.has(f)).sort(), modified: [...modified].sort() };
}

export const SUMMARY_SYSTEM_PROMPT = '你是一个上下文摘要助手。阅读一段用户与 AI 助手的对话，按指定格式输出结构化摘要。不要继续对话，不要回答对话里的问题，只输出摘要。';

const FORMAT = `## 目标
[用户想完成什么？可以有多项]

## 约束与偏好
- [用户提出的要求、限制、偏好；没有则写“（无）”]

## 进展
### 已完成
- [x] [完成的任务和修改]
### 进行中
- [ ] [当前工作]
### 受阻
- [阻碍，如有]

## 关键决定
- **[决定]**：[简要理由]

## 下一步
1. [接下来按顺序要做的事]

## 关键上下文
- [继续工作必须知道的数据、示例、引用；没有则写“（无）”]

每一节保持简洁。准确保留文件路径、函数名和错误信息。`;

export function summaryPrompt(conversation: string, previousSummary?: string, instructions?: string) {
  const head = `<conversation>\n${conversation}\n</conversation>\n\n`;
  const focus = instructions ? `\n\n额外要求：${instructions}` : '';
  if (!previousSummary) return `${head}以上是需要总结的对话。写一份结构化的“上下文检查点”摘要，另一个模型将据此继续工作。严格使用下面的格式：\n\n${FORMAT}${focus}`;
  return `${head}<previous-summary>\n${previousSummary}\n</previous-summary>\n\n以上是新的对话内容，请把它合并进 <previous-summary> 里的已有摘要。规则：保留已有信息；补充新的进展、决定和上下文；把完成的事项从“进行中”移到“已完成”；更新“下一步”。严格使用下面的格式：\n\n${FORMAT}${focus}`;
}

export interface CompactResult { summary: string; firstKeptId: string; tokensBefore: number; summarized: number; kept: number }

/**
 * 对会话的当前分支做一次压缩，成功后追加一条压缩记录。
 * 摘要请求失败或被截断时不写入任何东西：半截的摘要比没有摘要更糟。
 */
export async function compactSession(session: Session, model: Model, options: { keepRecentTokens?: number; instructions?: string; signal?: AbortSignal } = {}): Promise<CompactResult> {
  const path = session.path();
  const lastCompaction = path.findLastIndex(e => e.type === 'compaction');
  const previous = lastCompaction === -1 ? undefined : (path[lastCompaction] as Extract<Entry, { type: 'compaction' }>);
  // 上一次压缩保留下来的消息也要参与这一次的总结
  const startIndex = previous ? Math.max(0, path.findIndex(e => e.id === previous.firstKeptId)) : 0;
  const candidates = path.slice(startIndex).filter((e): e is Extract<Entry, { type: 'message' }> => e.type === 'message');
  const messages = candidates.map(e => e.message);
  const cut = findCutPoint(messages, options.keepRecentTokens);
  const toSummarize = messages.slice(0, cut.firstKeptIndex);
  if (toSummarize.length === 0) throw new Error('没有可以压缩的内容：最近的消息已经占满了保留额度');

  const reply = await model.stream({
    systemPrompt: SUMMARY_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: summaryPrompt(serializeConversation(toSummarize), previous?.summary, options.instructions) }],
    tools: [],
  }, { signal: options.signal });
  if (reply.stopReason !== 'stop') throw new Error(`摘要生成失败（${reply.stopReason}）：${reply.errorMessage ?? '输出被截断'}`);
  const text = reply.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('').trim();
  // 文件清单跨多次压缩累积：从上一份摘要里把旧清单读回来
  const listed = (tag: string) => previous?.summary.match(new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`))?.[1].split('\n') ?? [];
  const files = fileOperations(toSummarize, previous && { read: listed('read-files'), modified: listed('modified-files') });
  const fileList = [files.read.length ? `<read-files>\n${files.read.join('\n')}\n</read-files>` : '', files.modified.length ? `<modified-files>\n${files.modified.join('\n')}\n</modified-files>` : ''].filter(Boolean).join('\n\n');
  const summary = fileList ? `${text}\n\n${fileList}` : text;

  const tokensBefore = messages.reduce((n, m) => n + estimateMessageTokens(m), 0);
  const firstKeptId = candidates[cut.firstKeptIndex].id;
  session.appendCompaction(summary, firstKeptId, tokensBefore);
  return { summary, firstKeptId, tokensBefore, summarized: toSummarize.length, kept: messages.length - cut.firstKeptIndex };
}
