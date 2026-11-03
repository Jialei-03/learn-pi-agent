// 脚本模型（第 2 章起）：离线、确定、可重复。
// 回复由脚本函数决定，但仍然像真实模型一样“流式”地吐出事件，
// 所以 UI、循环和测试走的都是与真实模型相同的代码路径。
// 对照 Pi：packages/ai/src/providers/faux.ts（Pi 自己的测试也大量使用这种模型）。
import { previewJson } from '../partial-json.ts';
import type { AssistantMessage, Context, Model, StopReason, ToolCall } from '../types.ts';
import { emptyUsage } from '../types.ts';

export interface ScriptReply {
  text?: string;
  toolCalls?: { id?: string; name: string; arguments: Record<string, unknown> }[];
  stopReason?: StopReason;
  errorMessage?: string;
}
/** n 是第几次请求（从 1 开始）。脚本可以读取 context，根据工具结果决定下一步。 */
export type Script = (context: Context, n: number) => ScriptReply;

export function scripted(script: Script, options: { chunk?: number } = {}): Model {
  const size = options.chunk ?? 6;
  let requests = 0;
  return {
    id: 'scripted',
    async stream(context, { onEvent, signal } = {}) {
      const n = ++requests;
      const reply = script(context, n);
      const emit = onEvent ?? (() => {});
      const message: AssistantMessage = { role: 'assistant', content: [], stopReason: 'stop', usage: emptyUsage() };
      message.usage.input = JSON.stringify(context).length >> 2;   // 粗略估算：约 4 个字符一个 token
      if (signal?.aborted) return { ...message, stopReason: 'aborted', errorMessage: '请求已取消' };

      if (reply.text) {
        const block = { type: 'text' as const, text: '' };
        message.content.push(block);
        for (let i = 0; i < reply.text.length; i += size) {
          const delta = reply.text.slice(i, i + size);
          block.text += delta;
          emit({ type: 'text_delta', delta });
        }
      }
      for (const [index, call] of (reply.toolCalls ?? []).entries()) {
        const block: ToolCall = { type: 'toolCall', id: call.id ?? `call_${n}_${index + 1}`, name: call.name, arguments: {} };
        message.content.push(block);
        emit({ type: 'toolcall_start', id: block.id, name: block.name });
        const json = JSON.stringify(call.arguments);
        for (let i = 0; i < json.length; i += size) {
          emit({ type: 'toolcall_delta', id: block.id, delta: json.slice(i, i + size), preview: previewJson(json.slice(0, i + size)) });
        }
        block.arguments = call.arguments;
        emit({ type: 'toolcall_end', toolCall: block });
      }
      message.stopReason = reply.stopReason ?? (reply.toolCalls?.length ? 'toolUse' : 'stop');
      if (reply.errorMessage) message.errorMessage = reply.errorMessage;
      message.usage.output = JSON.stringify(message.content).length >> 2;
      emit({ type: 'done', message });
      return message;
    },
  };
}
