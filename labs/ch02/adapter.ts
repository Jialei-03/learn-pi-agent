// 练习的参考答案：给 mox 写一个 Anthropic 适配器。
// mox 的内部格式是 OpenAI 的格式，所以适配器要做三件事：
//   ① 请求方向：system 提到顶层；assistant 的 tool_calls 变成 tool_use 块（参数从 JSON 文本解析成对象）；
//              一批连续的 role: 'tool' 消息合并成同一条 user 消息里的 tool_result 块
//   ② 响应方向：把 Anthropic 的流式事件拼回 mox 的 { message, finish }
//   ③ 停止原因：end_turn → stop，tool_use → tool_calls，max_tokens → length，其余一律报错
// 返回值和 mox 的 openai() 是同一种 Model，所以 runLoop 一行都不用改。
import type { Model, Msg, ToolCall } from '../../mox/src/model.ts';

/** mox 消息 → Anthropic 请求体里的 system 和 messages。 */
export function toAnthropic(messages: Msg[]) {
  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const out: { role: 'user' | 'assistant'; content: any }[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'user') out.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: [
          ...(m.content ? [{ type: 'text', text: m.content }] : []),
          ...(m.tool_calls ?? []).map(c => ({ type: 'tool_use', id: c.id, name: c.function.name, input: JSON.parse(c.function.arguments || '{}') })),
        ],
      });
    } else {
      // mox 的工具消息没有“出错”标记，约定以“错误：”开头的就是失败（runLoop 正是这样写的）
      const block = { type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content, is_error: m.content.startsWith('错误：') };
      const last = out.at(-1);
      if (last?.role === 'user' && Array.isArray(last.content)) last.content.push(block);     // 同一批结果合并
      else out.push({ role: 'user', content: [block] });
    }
  }
  return { system, messages: out };
}

const FINISH: Record<string, string> = { end_turn: 'stop', stop_sequence: 'stop', tool_use: 'tool_calls', max_tokens: 'length' };

export function anthropic({ baseUrl = 'https://api.anthropic.com', apiKey = '', model = '', maxTokens = 8192 }): Model {
  return async ({ messages, tools = [], signal, onText }) => {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/messages`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model, max_tokens: maxTokens, stream: true, ...toAnthropic(messages),
        ...(tools.length ? { tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters })) } : {}),
      }),
    });
    if (!res.ok || !res.body) throw new Error(`模型请求失败（${res.status}）：${(await res.text()).slice(0, 500)}`);

    let text = '', stop = '', buffer = '';
    const calls: ToolCall[] = [];
    const byBlock = new Map<number, ToolCall>();                // Anthropic 按“块”编号，文字块和工具块共用一套编号
    const decoder = new TextDecoder();
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;                // event: 行不用看，data 里的 type 字段已经说明了
        const event = JSON.parse(line.slice(5));
        if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
          const call: ToolCall = { id: event.content_block.id, type: 'function', function: { name: event.content_block.name, arguments: '' } };
          byBlock.set(event.index, call);
          calls.push(call);
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') { text += event.delta.text; onText?.(event.delta.text); }
          if (event.delta.type === 'input_json_delta') byBlock.get(event.index)!.function.arguments += event.delta.partial_json;
        } else if (event.type === 'message_delta') {
          stop = event.delta.stop_reason ?? stop;
        } else if (event.type === 'error') {
          throw new Error(`模型返回错误：${event.error?.message}`);
        }
      }
    }
    // 和 mox 的 openai() 不同：没收到停止原因、或者停止原因不认识，都当作失败
    if (!stop) throw new Error('流在给出 stop_reason 之前就结束了');
    if (!(stop in FINISH)) throw new Error(`不认识的 stop_reason：${stop}`);
    return { message: { role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) }, finish: FINISH[stop] };
  };
}
