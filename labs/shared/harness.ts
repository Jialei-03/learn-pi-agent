// 对照实验的公共部分：同一份模型脚本、同一组工具，分别交给 mox 的 runLoop 和 Pi 的 runAgentLoop。
// 工具用普通 JSON Schema 描述参数；Pi 的校验器同样接受 JSON Schema，所以两边用的是同一份定义。
// mox 一侧直接调用 mox/src/loop.ts 的 runLoop（脚本模型来自 scripted.ts）；Pi 一侧用它的 faux 模型。
import { runAgentLoop } from '@earendil-works/pi-agent-core';
import { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { runLoop, type LoopOptions, type Tool } from '../../mox/src/loop.ts';
import type { AssistantMsg, Msg } from '../../mox/src/model.ts';
import { scripted, type Script } from './scripted.ts';

/** 工具可以返回字符串，也可以返回 { content, terminate }。mox 只认字符串，terminate 只有 Pi 看得懂。 */
export type RunTool = Omit<Tool, 'run'> & {
  run: (args: any, signal?: AbortSignal) => Promise<string | { content: string; terminate?: boolean }> | string | { content: string; terminate?: boolean };
  /** 只有 Pi 认：声明这个工具必须串行 */
  executionMode?: 'sequential';
};

export interface RunSpec {
  prompt: string;
  script: Script;
  tools: RunTool[];
  /** 和 mox 的 LoopOptions 同名同义：返回字符串 = 拒绝，字符串是理由 */
  beforeTool?: LoopOptions['beforeTool'];
  /** 返回字符串 = 替换工具结果 */
  afterTool?: LoopOptions['afterTool'];
  /** 只有 Pi 认；mox 没有这个选项，永远串行 */
  toolExecution?: 'parallel' | 'sequential';
  maxRequests?: number;
  /** 想换掉 mox 的 runLoop（比如实验里的“你来改”参考实现）时传入 */
  loop?: typeof runLoop;
}

export interface ToolOutcome { id: string; name: string; content: string; isError: boolean }
export interface RunReport {
  /** 模型被请求了几次 */
  requests: number;
  /** 本次运行追加的消息，统一成 mox（OpenAI）的格式 */
  messages: Msg[];
  /** 事件名，工具完成记为 tool_end:调用 id */
  events: string[];
  /** 每个工具调用最终交给模型的结果 */
  results: ToolOutcome[];
}

const plain = (tool: RunTool): Tool => ({
  ...tool,
  run: async (args, signal) => {
    const out = await tool.run(args, signal);
    return typeof out === 'string' ? out : out.content;
  },
});

export async function runMox(spec: RunSpec, onEvent?: (e: Parameters<NonNullable<LoopOptions['onEvent']>>[0]) => void): Promise<RunReport> {
  const model = scripted(spec.script);
  const events: string[] = [];
  const results: ToolOutcome[] = [];
  const messages: Msg[] = [{ role: 'user', content: spec.prompt }];
  await (spec.loop ?? runLoop)(messages, {
    model, system: '', tools: spec.tools.map(plain), beforeTool: spec.beforeTool, afterTool: spec.afterTool,
    onEvent: e => {
      events.push(e.type === 'tool_end' ? `tool_end:${e.call.id}` : e.type);
      if (e.type === 'tool_end') results.push({ id: e.call.id, name: e.call.function.name, content: e.result, isError: e.error });
      onEvent?.(e);
    },
  });
  return { requests: model.requests.length, messages: messages.slice(1), events, results };
}

/** Pi 的消息 → mox（OpenAI）的格式，方便两边用同一套代码比较。 */
export function toMox(m: any): Msg | undefined {
  const text = (c: any) => (typeof c === 'string' ? c : c.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(''));
  if (m.role === 'user') return { role: 'user', content: text(m.content) };
  if (m.role === 'toolResult') return { role: 'tool', tool_call_id: m.toolCallId, content: text(m.content) };
  if (m.role === 'assistant') {
    const calls = m.content.filter((b: any) => b.type === 'toolCall');
    const content = text(m.content);
    return {
      role: 'assistant', content: content || null,
      ...(calls.length ? { tool_calls: calls.map((c: any) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: JSON.stringify(c.arguments) } })) } : {}),
    } satisfies AssistantMsg;
  }
  return undefined;
}

const asPiResult = (out: string | { content: string; terminate?: boolean }) => {
  const r = typeof out === 'string' ? { content: out } : out;
  return { content: [{ type: 'text' as const, text: r.content }], details: undefined, ...(r.terminate ? { terminate: true } : {}) };
};

export async function runPi(spec: RunSpec): Promise<RunReport> {
  const faux = createFauxCore({});
  let requests = 0;
  const events: string[] = [];
  faux.setResponses(Array.from({ length: spec.maxRequests ?? 8 }, (_, i) => (context: any) => {
    const history = context.messages.map(toMox).filter(Boolean) as Msg[];
    const reply = spec.script([{ role: 'system', content: '' }, ...history], i + 1);
    const blocks = [...(reply.text ? [fauxText(reply.text)] : []), ...(reply.toolCalls ?? []).map((c, j) => fauxToolCall(c.name, c.arguments as any, { id: c.id ?? `call_${i + 1}_${j + 1}` }))];
    return fauxAssistantMessage(blocks, { stopReason: reply.finish === 'length' ? 'length' : reply.toolCalls?.length ? 'toolUse' : 'stop' });
  }));
  const tools = spec.tools.map(t => ({
    name: t.name, label: t.name, description: t.description, parameters: t.parameters,
    ...(t.executionMode ? { executionMode: t.executionMode } : {}),
    async execute(_id: string, args: any, signal?: AbortSignal) {
      return asPiResult(await t.run(args, signal));
    },
  }));
  const results: ToolOutcome[] = [];
  const added = await runAgentLoop(
    [{ role: 'user', content: spec.prompt, timestamp: 0 }],
    { messages: [], tools: tools as any },
    {
      model: faux.getModel(), convertToLlm: (m: any) => m,
      toolExecution: spec.toolExecution,
      beforeToolCall: spec.beforeTool ? async ({ toolCall, args }: any) => {
        const reason = await spec.beforeTool!(toolCall.name, args);
        return reason ? { block: true, reason: String(reason) } : undefined;
      } : undefined,
      afterToolCall: spec.afterTool ? async ({ toolCall, args, result }: any) => {
        const text = result.content.map((b: any) => b.text ?? '').join('');
        const replaced = await spec.afterTool!(toolCall.name, args, text);
        return replaced ? { content: [{ type: 'text', text: String(replaced) }] } : undefined;
      } : undefined,
    } as any,
    (e: any) => { events.push(e.type === 'tool_execution_end' ? `tool_end:${e.toolCallId}` : e.type); }, undefined,
    (m, c, o) => { requests++; return faux.streamSimple(m, c, o); },
  );
  for (const m of added as any[]) {
    if (m.role === 'toolResult') results.push({ id: m.toolCallId, name: m.toolName, content: m.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(''), isError: !!m.isError });
  }
  return { requests, messages: added.map(toMox).filter(Boolean) as Msg[], events, results };
}

/** 最后一条带文字的 assistant 消息。 */
export const lastText = (messages: Msg[]) =>
  messages.findLast(m => m.role === 'assistant' && m.content)?.content ?? '（没有文字回答）';
