// 轨迹（第 20 章）：一次运行留下的完整消息记录。评测只告诉你“失败了”，轨迹告诉你“怎么失败的”。
import type { Message } from '../mox/src/types.ts';

export interface TrajectorySummary {
  turns: number;
  tools: Record<string, number>;
  toolErrors: number;
  /** 一模一样的工具调用出现了不止一次：常常是在原地打转 */
  repeatedCalls: number;
  input: number;
  cacheRead: number;
  output: number;
  /** 模型最后一次修改文件之后，有没有再运行过命令来验证 */
  verifiedAfterLastEdit: boolean;
}

export function summarize(messages: Message[]): TrajectorySummary {
  const s: TrajectorySummary = { turns: 0, tools: {}, toolErrors: 0, repeatedCalls: 0, input: 0, cacheRead: 0, output: 0, verifiedAfterLastEdit: false };
  const seen = new Set<string>();
  let lastEdit = -1, lastBash = -1, i = 0;
  for (const m of messages) {
    i++;
    if (m.role === 'assistant') {
      s.turns++;
      s.input += m.usage.input; s.cacheRead += m.usage.cacheRead; s.output += m.usage.output;
      for (const b of m.content) {
        if (b.type !== 'toolCall') continue;
        s.tools[b.name] = (s.tools[b.name] ?? 0) + 1;
        const key = `${b.name}:${JSON.stringify(b.arguments)}`;
        if (seen.has(key)) s.repeatedCalls++;
        seen.add(key);
        if (b.name === 'edit' || b.name === 'write') lastEdit = i;
        if (b.name === 'bash') lastBash = i;
      }
    }
    if (m.role === 'toolResult' && m.isError) s.toolErrors++;
  }
  s.verifiedAfterLastEdit = lastEdit >= 0 && lastBash > lastEdit;
  return s;
}

/** 轨迹的简短文字版：每一步一行 */
export function outline(messages: Message[], width = 90): string[] {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.role === 'user') lines.push(`用户：${m.content.slice(0, width)}`);
    if (m.role === 'assistant') for (const b of m.content) {
      if (b.type === 'text' && b.text.trim()) lines.push(`模型：${b.text.replace(/\s+/g, ' ').slice(0, width)}`);
      if (b.type === 'toolCall') lines.push(`  → ${b.name} ${JSON.stringify(b.arguments).replace(/\\n/g, '⏎').slice(0, width)}`);
    }
    if (m.role === 'toolResult') lines.push(`    ${m.isError ? '✗' : '✓'} ${m.content.replace(/\s+/g, ' ').slice(0, width - 10)}`);
  }
  return lines;
}
