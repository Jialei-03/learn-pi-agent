// 脚本模型：mox 的 Model 只是一个函数，离线实验里按脚本返回回复即可，不需要服务器，也不需要 API Key。
// 文字照样一段段通过 onText 流出来，所以界面和循环走的是和真实模型相同的代码路径。
import type { Model, Msg, Request, ToolCall } from '../../mox/src/model.ts';

export type ScriptReply = { text?: string; toolCalls?: { id?: string; name: string; arguments: object }[]; finish?: string };
/** n 是第几次请求（从 1 开始）；messages 是这次请求发出的完整消息（第一条是系统提示）。 */
export type Script = (messages: Msg[], n: number) => ScriptReply;

export function scripted(script: Script | ScriptReply[], { chunk = 6 } = {}): Model & { requests: Request[] } {
  const requests: Request[] = [];
  const model: Model = async request => {
    requests.push(request);
    const n = requests.length;
    if (request.signal?.aborted) throw new DOMException('This operation was aborted', 'AbortError');
    const reply = typeof script === 'function' ? script(request.messages, n) : script[n - 1] ?? { text: '（脚本已用完）' };
    for (let i = 0; i < (reply.text ?? '').length; i += chunk) request.onText?.(reply.text!.slice(i, i + chunk));
    const calls: ToolCall[] = (reply.toolCalls ?? []).map((c, i) => ({
      id: c.id ?? `call_${n}_${i + 1}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.arguments) },
    }));
    return {
      message: { role: 'assistant', content: reply.text ?? null, ...(calls.length ? { tool_calls: calls } : {}) },
      finish: reply.finish ?? (calls.length ? 'tool_calls' : 'stop'),
    };
  };
  return Object.assign(model, { requests });
}
