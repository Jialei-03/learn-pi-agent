// 发送前修复历史（第 7 章）。只影响这一次请求的“投影”，保存的会话记录不变。
// 对照 Pi：packages/ai/src/api/transform-messages.ts
import type { AssistantMessage, Message, ToolCall } from './types.ts';

/**
 * 两类问题会让服务商拒绝请求，常见于崩溃或取消之后恢复的会话：
 * 1. 失败或被取消的回复：内容可能只有一半（半截的工具调用），重放它没有意义，直接跳过；
 * 2. 有工具调用却没有对应结果：补一条“没有结果”的错误结果，满足“每个调用都有结果”的要求。
 */
export function repairTranscript(messages: Message[]): Message[] {
  const out: Message[] = [];
  let pending: ToolCall[] = [];
  const answered = new Set<string>();
  const close = () => {
    for (const call of pending) {
      if (!answered.has(call.id)) out.push({ role: 'toolResult', toolCallId: call.id, toolName: call.name, content: '没有结果（运行在工具完成前中断了）', isError: true });
    }
    pending = [];
    answered.clear();
  };
  for (const m of messages) {
    if (m.role === 'assistant') {
      close();
      if (m.stopReason === 'error' || m.stopReason === 'aborted') continue;
      pending = (m as AssistantMessage).content.filter((b): b is ToolCall => b.type === 'toolCall');
      out.push(m);
    } else if (m.role === 'toolResult') {
      answered.add(m.toolCallId);
      out.push(m);
    } else {
      close();                                                  // 新的用户消息打断了工具流程
      out.push(m);
    }
  }
  close();
  return out;
}
