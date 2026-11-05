// 轨迹（第 20 章）：一次运行留下的完整消息记录。评测只告诉你“失败了”，轨迹告诉你“怎么失败的”。
// mox 的会话文件（JSONL）里就是 OpenAI 格式的消息：assistant 带 tool_calls，工具结果是 role 为 tool 的消息，出错的结果以“错误：”开头。
import { estimateTokens } from '../mox/src/compact.ts';
import type { Msg } from '../mox/src/model.ts';

export interface TrajectorySummary {
  turns: number;
  tools: Record<string, number>;
  toolErrors: number;
  /** 一模一样的工具调用出现了不止一次：常常是在原地打转 */
  repeatedCalls: number;
  /** 估算的输入 token（累计） */
  input: number;
  /** 模型最后一次修改文件之后，有没有再运行过命令来验证 */
  verifiedAfterLastEdit: boolean;
}

export function summarize(messages: Msg[]): TrajectorySummary {
  const s: TrajectorySummary = { turns: 0, tools: {}, toolErrors: 0, repeatedCalls: 0, input: 0, verifiedAfterLastEdit: false };
  const seen = new Set<string>();
  let lastEdit = -1, lastBash = -1;
  messages.forEach((m, i) => {
    if (m.role === 'assistant') {
      s.turns++;
      s.input += estimateTokens(messages.slice(0, i));
      for (const call of m.tool_calls ?? []) {
        const name = call.function.name;
        s.tools[name] = (s.tools[name] ?? 0) + 1;
        const key = `${name}:${call.function.arguments}`;
        if (seen.has(key)) s.repeatedCalls++;
        seen.add(key);
        if (name === 'edit' || name === 'write') lastEdit = i;
        if (name === 'bash') lastBash = i;
      }
    }
    if (m.role === 'tool' && m.content.startsWith('错误：')) s.toolErrors++;
  });
  s.verifiedAfterLastEdit = lastEdit >= 0 && lastBash > lastEdit;
  return s;
}

/** 轨迹的简短文字版：每一步一行 */
export function outline(messages: Msg[], width = 90): string[] {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.role === 'user') lines.push(`用户：${m.content.replace(/\s+/g, ' ').slice(0, width)}`);
    if (m.role === 'assistant') {
      if (m.content?.trim()) lines.push(`模型：${m.content.replace(/\s+/g, ' ').slice(0, width)}`);
      for (const c of m.tool_calls ?? []) lines.push(`  → ${c.function.name} ${c.function.arguments.replace(/\\n/g, '⏎').slice(0, width)}`);
    }
    if (m.role === 'tool') lines.push(`    ${m.content.startsWith('错误：') ? '✗' : '✓'} ${m.content.replace(/\s+/g, ' ').slice(0, width - 10)}`);
  }
  return lines;
}
