// OpenAI Chat Completions 适配器（第 2 章）。DeepSeek、通义、Kimi、Ollama 等“OpenAI 兼容”服务都走这一路。
// 对照 Pi：packages/ai/src/api/openai-completions.ts
import { readSse } from '../sse.ts';
import { parseArguments, previewJson } from '../partial-json.ts';
import type { AssistantMessage, Context, Message, Model, StopReason, StreamOptions, TextContent, ToolCall } from '../types.ts';
import { emptyUsage, failedMessage } from '../types.ts';

export interface OpenAIOptions { apiKey: string; model: string; baseUrl?: string }

/**
 * 内部消息 → Chat Completions 的 messages。
 * 与 Anthropic 相反：系统提示是第一条 role=system 的消息；工具结果是独立的 role=tool 消息；
 * 工具参数以 JSON 字符串（不是对象）传输。
 */
export function toOpenAIMessages(systemPrompt: string, messages: Message[]) {
  const out: Record<string, unknown>[] = [{ role: 'system', content: systemPrompt }];
  for (const message of messages) {
    if (message.role === 'user') out.push({ role: 'user', content: message.content });
    else if (message.role === 'assistant') {
      const text = message.content.filter(b => b.type === 'text').map(b => (b as TextContent).text).join('');
      const calls = message.content.filter(b => b.type === 'toolCall') as ToolCall[];
      out.push({
        role: 'assistant',
        content: text || null,
        ...(calls.length > 0 && {
          tool_calls: calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.arguments) } })),
        }),
      });
    } else out.push({ role: 'tool', tool_call_id: message.toolCallId, content: message.content });
  }
  return out;
}

export function openaiRequestBody(context: Context, model: string) {
  return {
    model,
    messages: toOpenAIMessages(context.systemPrompt, context.messages),
    tools: context.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
    stream: true,
    stream_options: { include_usage: true }, // 让最后一个 chunk 带上 token 用量
  };
}

export function mapOpenAIFinishReason(raw: string): { stopReason: StopReason; errorMessage?: string } {
  switch (raw) {
    case 'stop':
      return { stopReason: 'stop' };
    case 'length':
      return { stopReason: 'length' };
    case 'tool_calls':
    case 'function_call':
      return { stopReason: 'toolUse' };
    case 'content_filter':
      return { stopReason: 'error', errorMessage: '内容被服务商的安全过滤拦截' };
    default:
      return { stopReason: 'error', errorMessage: `未知的结束原因：${raw}` };
  }
}

/** 把 Chat Completions 的 SSE 流组装成一条 AssistantMessage。 */
export async function parseOpenAIStream(body: ReadableStream<Uint8Array>, options: StreamOptions = {}): Promise<AssistantMessage> {
  const message: AssistantMessage = { role: 'assistant', content: [], stopReason: 'stop', usage: emptyUsage() };
  const emit = options.onEvent ?? (() => {});
  let text: TextContent | undefined;
  const calls = new Map<number, { block: ToolCall; json: string }>(); // 工具调用按 delta 里的 index 区分，而不是按 id
  for await (const sse of readSse(body)) {
    if (sse.data === '[DONE]') break;
    const chunk = JSON.parse(sse.data);
    if (chunk.error) return { ...message, stopReason: 'error', errorMessage: chunk.error.message ?? sse.data };
    if (chunk.usage) {
      // 各家把“命中缓存的输入”放在不同字段：OpenAI 在 prompt_tokens_details 里，DeepSeek 叫 prompt_cache_hit_tokens，Kimi 放在顶层。
      const cached = chunk.usage.prompt_tokens_details?.cached_tokens ?? chunk.usage.prompt_cache_hit_tokens ?? chunk.usage.cached_tokens ?? 0;
      // OpenAI 的 prompt_tokens 包含了缓存命中的部分；统一成 Anthropic 的口径：input 只算没命中缓存的输入
      message.usage.input = Math.max(0, (chunk.usage.prompt_tokens ?? 0) - cached);
      message.usage.output = chunk.usage.completion_tokens ?? 0;
      message.usage.cacheRead = cached;
    }
    const choice = chunk.choices?.[0];
    if (!choice) continue;                                    // 只带 usage 的最后一个 chunk 没有 choices
    const delta = choice.delta ?? {};
    if (delta.content) {
      if (!text) message.content.push((text = { type: 'text', text: '' }));
      text.text += delta.content;
      emit({ type: 'text_delta', delta: delta.content });
    }
    for (const part of delta.tool_calls ?? []) {
      let entry = calls.get(part.index);
      if (!entry) {                                           // 第一个分片带 id 和 name，后面的分片只带参数
        entry = { block: { type: 'toolCall', id: part.id, name: part.function?.name ?? '', arguments: {} }, json: '' };
        calls.set(part.index, entry);
        message.content.push(entry.block);
        emit({ type: 'toolcall_start', id: entry.block.id, name: entry.block.name });
      }
      const piece = part.function?.arguments ?? '';
      if (piece) {
        entry.json += piece;
        emit({ type: 'toolcall_delta', id: entry.block.id, delta: piece, preview: previewJson(entry.json) });
      }
    }
    if (choice.finish_reason) {
      message.rawStopReason = choice.finish_reason;
      Object.assign(message, mapOpenAIFinishReason(choice.finish_reason));
    }
  }
  if (!message.rawStopReason) return { ...message, stopReason: 'error', errorMessage: '响应流在给出结束原因之前就结束了' };
  // Chat Completions 没有“块结束”事件：整条流结束后，参数才算完整
  for (const { block, json } of calls.values()) {
    const parsed = parseArguments(json);
    block.arguments = parsed.value;
    if (parsed.error && message.stopReason !== 'length') Object.assign(message, { stopReason: 'error', errorMessage: parsed.error });
    emit({ type: 'toolcall_end', toolCall: block });
  }
  emit({ type: 'done', message });
  return message;
}

export function openai(options: OpenAIOptions): Model {
  return {
    id: `openai-compatible/${options.model}`,
    async stream(context, streamOptions = {}) {
      try {
        const response = await fetch(`${options.baseUrl ?? 'https://api.openai.com/v1'}/chat/completions`, {
          method: 'POST',
          signal: streamOptions.signal,
          headers: { 'content-type': 'application/json', authorization: `Bearer ${options.apiKey}` },
          body: JSON.stringify(openaiRequestBody(context, options.model)),
        });
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        return await parseOpenAIStream(response.body, streamOptions);
      } catch (error) {
        return failedMessage(error, streamOptions.signal);
      }
    },
  };
}
