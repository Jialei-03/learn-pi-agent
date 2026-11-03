// Anthropic Messages API 适配器（第 2 章）。
// 对照 Pi：packages/ai/src/api/anthropic-messages.ts（convertMessages、iterateAnthropicEvents、mapStopReason）
import { readSse } from '../sse.ts';
import { parseArguments, previewJson } from '../partial-json.ts';
import type { AssistantMessage, Context, Message, Model, StopReason, StreamOptions, TextContent, ToolCall } from '../types.ts';
import { emptyUsage, failedMessage } from '../types.ts';

export interface AnthropicOptions { apiKey: string; model: string; baseUrl?: string; maxTokens?: number }

/**
 * 内部消息 → Anthropic 请求体中的 messages。
 * 两个关键差异：
 * 1. 系统提示不在 messages 里，而是顶层的 system 字段；
 * 2. 工具结果没有自己的角色，要包成 user 消息里的 tool_result 块。
 *    Anthropic 要求 tool_result 紧跟在对应的 tool_use 之后，所以同一批工具的结果合并进同一条 user 消息。
 */
export function toAnthropicMessages(messages: Message[]) {
  const out: { role: 'user' | 'assistant'; content: unknown[] }[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      out.push({ role: 'user', content: [{ type: 'text', text: message.content }] });
    } else if (message.role === 'assistant') {
      const content = message.content.map(block =>
        block.type === 'text'
          ? { type: 'text', text: block.text }
          : { type: 'tool_use', id: block.id, name: block.name, input: block.arguments },
      );
      if (content.length > 0) out.push({ role: 'assistant', content });
    } else {
      const result = { type: 'tool_result', tool_use_id: message.toolCallId, content: message.content, is_error: message.isError };
      const last = out.at(-1);
      // 连续的工具结果合并进同一条 user 消息，紧跟在发出这些 tool_use 的 assistant 消息后面
      if (last?.role === 'user' && last.content.every(b => (b as { type: string }).type === 'tool_result')) last.content.push(result);
      else out.push({ role: 'user', content: [result] });
    }
  }
  return out;
}

export function anthropicRequestBody(context: Context, model: string, maxTokens = 4096) {
  return {
    model,
    max_tokens: maxTokens,
    system: context.systemPrompt,
    messages: toAnthropicMessages(context.messages),
    tools: context.tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters })),
    stream: true,
  };
}

/** 服务商的停止原因 → 归一化的停止原因。未知值按错误处理，而不是假装正常结束。 */
export function mapAnthropicStopReason(raw: string): { stopReason: StopReason; errorMessage?: string } {
  switch (raw) {
    case 'end_turn':
    case 'stop_sequence':
    case 'pause_turn':
      return { stopReason: 'stop' };
    case 'max_tokens':
      return { stopReason: 'length' };
    case 'tool_use':
      return { stopReason: 'toolUse' };
    case 'refusal':
      return { stopReason: 'error', errorMessage: '模型拒绝了这次请求' };
    default:
      return { stopReason: 'error', errorMessage: `未知的停止原因：${raw}` };
  }
}

/** 把 Anthropic 的 SSE 事件流组装成一条 AssistantMessage。单独导出，方便用录制的流测试。 */
export async function parseAnthropicStream(body: ReadableStream<Uint8Array>, options: StreamOptions = {}): Promise<AssistantMessage> {
  const message: AssistantMessage = { role: 'assistant', content: [], stopReason: 'stop', usage: emptyUsage() };
  const open = new Map<number, { block: TextContent | ToolCall; json?: string }>(); // 按服务端的 index 记录正在生成的块
  const emit = options.onEvent ?? (() => {});
  let badArguments: string | undefined;
  for await (const sse of readSse(body)) {
    const event = JSON.parse(sse.data);
    switch (event.type) {
      case 'message_start':
        message.usage.input = event.message.usage?.input_tokens ?? 0;
        message.usage.cacheRead = event.message.usage?.cache_read_input_tokens ?? 0;
        message.usage.cacheWrite = event.message.usage?.cache_creation_input_tokens ?? 0;
        break;
      case 'content_block_start': {
        const cb = event.content_block;
        if (cb.type === 'text') {
          const block: TextContent = { type: 'text', text: cb.text ?? '' };
          message.content.push(block);
          open.set(event.index, { block });
        } else if (cb.type === 'tool_use') {
          const block: ToolCall = { type: 'toolCall', id: cb.id, name: cb.name, arguments: {} };
          message.content.push(block);
          open.set(event.index, { block, json: '' });
          emit({ type: 'toolcall_start', id: cb.id, name: cb.name });
        }
        break;
      }
      case 'content_block_delta': {
        const entry = open.get(event.index);
        if (!entry) break;
        if (event.delta.type === 'text_delta' && entry.block.type === 'text') {
          entry.block.text += event.delta.text;
          emit({ type: 'text_delta', delta: event.delta.text });
        } else if (event.delta.type === 'input_json_delta' && entry.block.type === 'toolCall') {
          entry.json += event.delta.partial_json;               // 参数是一段段 JSON 文本，先攒着
          emit({ type: 'toolcall_delta', id: entry.block.id, delta: event.delta.partial_json, preview: previewJson(entry.json!) });
        }
        break;
      }
      case 'content_block_stop': {
        const entry = open.get(event.index);
        open.delete(event.index);
        if (entry?.block.type === 'toolCall') {
          const parsed = parseArguments(entry.json!);             // 块结束，参数才完整
          entry.block.arguments = parsed.value;
          if (parsed.error) badArguments = parsed.error;
          emit({ type: 'toolcall_end', toolCall: entry.block });
        }
        break;
      }
      case 'message_delta':
        if (event.delta?.stop_reason) {
          message.rawStopReason = event.delta.stop_reason;
          Object.assign(message, mapAnthropicStopReason(event.delta.stop_reason));
        }
        if (event.usage?.output_tokens != null) message.usage.output = event.usage.output_tokens;
        break;
      case 'error':
        return { ...message, stopReason: 'error', errorMessage: event.error?.message ?? sse.data };
    }
  }
  // 连接中途断开时不会有 message_delta：没有停止原因，就不能当作正常结束
  if (!message.rawStopReason) return { ...message, stopReason: 'error', errorMessage: '响应流在给出停止原因之前就结束了' };
  // 截断时参数不完整是预期内的，交给循环处理；其他情况下参数坏了就是错误
  if (badArguments && message.stopReason !== 'length') Object.assign(message, { stopReason: 'error', errorMessage: badArguments });
  emit({ type: 'done', message });
  return message;
}

export function anthropic(options: AnthropicOptions): Model {
  return {
    id: `anthropic/${options.model}`,
    async stream(context, streamOptions = {}) {
      try {
        const response = await fetch(`${options.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`, {
          method: 'POST',
          signal: streamOptions.signal,
          headers: { 'content-type': 'application/json', 'x-api-key': options.apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify(anthropicRequestBody(context, options.model, options.maxTokens)),
        });
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        return await parseAnthropicStream(response.body, streamOptions);
      } catch (error) {
        return failedMessage(error, streamOptions.signal);
      }
    },
  };
}
