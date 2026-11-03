// 崩溃后继续（第 18 章）。会话每条消息一形成就写盘（第 7 章），所以进程死掉之后，记录停在哪里就知道断在哪里：
//   · 最后一条是助手的工具调用，但缺少结果：工具执行到一半（或执行完了，结果还没来得及写下）；
//   · 最后一条是用户消息或工具结果：模型还没回复。
// 难的是第一种：不知道工具到底生效了没有。重新执行，可能把同一件事做两遍；不执行，可能漏掉。
// 这里的规则与 Pi 的 durable 包相同：声明了 replaySafe 的工具（只读、幂等）直接重新执行；其他的写一条“中断”结果，交给模型去查证。
import { runTools, type AgentTool, type ToolHooks } from './tools.ts';
import type { Message, ToolCall, ToolResultMessage } from './types.ts';

export const INTERRUPTED = '进程在这个工具执行期间中断了：不知道它是否已经生效。请先检查现状（文件是否已经改了、命令的效果是否已经发生），再决定要不要重试。';

/** 会话末尾没有结果的工具调用 */
export function findInterrupted(messages: Message[]): ToolCall[] {
  const i = messages.findLastIndex(m => m.role === 'assistant');
  const last = messages[i];
  if (!last || last.role !== 'assistant') return [];
  const answered = new Set(messages.slice(i + 1).flatMap(m => (m.role === 'toolResult' ? [m.toolCallId] : [])));
  return last.content.filter((b): b is ToolCall => b.type === 'toolCall' && !answered.has(b.id));
}

/** 运行是否没有结束：模型还欠一个回复，或者有工具调用没有结果 */
export function needsResume(messages: Message[]): boolean {
  const last = messages.at(-1);
  return !!last && (last.role !== 'assistant' || findInterrupted(messages).length > 0);
}

/** 为中断的调用补上结果：重放安全的重新执行，其他的如实告诉模型“中断了” */
export async function settleInterrupted(calls: ToolCall[], tools: AgentTool[], hooks?: ToolHooks): Promise<ToolResultMessage[]> {
  const results: ToolResultMessage[] = [];
  for (const call of calls) {
    const tool = tools.find(t => t.name === call.name);
    if (tool?.replaySafe) {
      const batch = await runTools([call], tools, { emit: () => {}, hooks });
      results.push(...batch.results);
    } else {
      results.push({ role: 'toolResult', toolCallId: call.id, toolName: call.name, content: INTERRUPTED, isError: true });
    }
  }
  return results;
}
