// 对照实验的公共部分：同一份模型脚本、同一组工具，分别交给 mox 的 runLoop 和 Pi 的 runAgentLoop。
// 工具用普通 JSON Schema 描述参数；Pi 的校验器同样接受 JSON Schema，所以两边用的是同一份定义。
import { runAgentLoop } from '@earendil-works/pi-agent-core';
import { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { runLoop, type AgentEvent } from '../../mox/src/loop.ts';
import { scripted, type Script } from '../../mox/src/providers/scripted.ts';
import type { AgentTool, ToolHooks, ToolResult } from '../../mox/src/tools.ts';
import type { AssistantMessage, Message } from '../../mox/src/types.ts';

export interface RunSpec {
  prompt: string;
  script: Script;
  tools: AgentTool[];
  hooks?: ToolHooks;
  toolExecution?: 'parallel' | 'sequential';
  maxRequests?: number;
}

export interface RunReport { requests: number; messages: Message[]; events: string[] }

export async function runMox(spec: RunSpec, onEvent?: (e: AgentEvent) => void): Promise<RunReport> {
  let requests = 0;
  const events: string[] = [];
  const inner = scripted(spec.script);
  const model = { id: 'scripted', stream: (ctx: any, opts: any) => { requests++; return inner.stream(ctx, opts); } };
  const { messages } = await runLoop([], [{ role: 'user', content: spec.prompt }], {
    model, systemPrompt: '', tools: spec.tools, hooks: spec.hooks, toolExecution: spec.toolExecution,
    onEvent: e => { events.push(e.type === 'tool_end' ? `tool_end:${e.result.toolCallId}` : e.type); onEvent?.(e); },
  });
  return { requests, messages, events };
}

/** Pi 的消息 → mox 的最小格式，方便两边用同一套代码比较。 */
export function toMox(m: any): Message | undefined {
  const text = (c: any) => (typeof c === 'string' ? c : c.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(''));
  if (m.role === 'user') return { role: 'user', content: text(m.content) };
  if (m.role === 'toolResult') return { role: 'toolResult', toolCallId: m.toolCallId, toolName: m.toolName, content: text(m.content), isError: m.isError };
  if (m.role === 'assistant') return { ...m, content: m.content.filter((b: any) => b.type !== 'thinking') } as AssistantMessage;
  return undefined;
}

const asPiResult = (out: string | ToolResult) => {
  const r = typeof out === 'string' ? { content: out } : out;
  return { content: [{ type: 'text' as const, text: r.content }], details: r.details, ...(r.isError ? { isError: true } : {}), ...(r.terminate ? { terminate: true } : {}) };
};

export async function runPi(spec: RunSpec): Promise<RunReport> {
  const faux = createFauxCore({});
  let requests = 0;
  const events: string[] = [];
  faux.setResponses(Array.from({ length: spec.maxRequests ?? 8 }, (_, i) => (context: any) => {
    const reply = spec.script({ systemPrompt: '', tools: [], messages: context.messages.map(toMox).filter(Boolean) }, i + 1);
    const blocks = [...(reply.text ? [fauxText(reply.text)] : []), ...(reply.toolCalls ?? []).map((c, j) => fauxToolCall(c.name, c.arguments, { id: c.id ?? `call_${i + 1}_${j + 1}` }))];
    return fauxAssistantMessage(blocks, { stopReason: reply.stopReason ?? (reply.toolCalls?.length ? 'toolUse' : 'stop') });
  }));
  const tools = spec.tools.map(t => ({
    name: t.name, label: t.name, description: t.description, parameters: t.parameters,
    ...(t.executionMode ? { executionMode: t.executionMode } : {}),
    ...(t.prepareArguments ? { prepareArguments: (a: any) => t.prepareArguments!(a) } : {}),
    async execute(id: string, args: any, signal?: AbortSignal) {
      return asPiResult(await t.execute(args, { toolCallId: id, signal }));
    },
  }));
  const hooks = spec.hooks;
  const added = await runAgentLoop(
    [{ role: 'user', content: spec.prompt, timestamp: 0 }],
    { messages: [], tools: tools as any },
    {
      model: faux.getModel(), convertToLlm: m => m as any,
      toolExecution: spec.toolExecution,
      beforeToolCall: hooks?.beforeToolCall ? async ({ toolCall, args }: any) => (await hooks.beforeToolCall!(toolCall, args)) ?? undefined : undefined,
      afterToolCall: hooks?.afterToolCall ? async ({ toolCall, args, result, isError }: any) => {
        const current = { content: result.content.map((b: any) => b.text ?? '').join(''), isError };
        const patch = await hooks.afterToolCall!(toolCall, args, current);
        if (!patch) return undefined;
        return { ...(patch.content !== undefined ? { content: [{ type: 'text', text: patch.content }] } : {}), ...(patch.isError !== undefined ? { isError: patch.isError } : {}), ...(patch.terminate !== undefined ? { terminate: patch.terminate } : {}) };
      } : undefined,
    } as any,
    (e: any) => { events.push(e.type === 'tool_execution_end' ? `tool_end:${e.toolCallId}` : e.type); }, undefined,
    (m, c, o) => { requests++; return faux.streamSimple(m, c, o); },
  );
  return { requests, messages: added.map(toMox).filter(Boolean) as Message[], events };
}

export const lastText = (messages: Message[]) =>
  (messages.findLast(m => m.role === 'assistant' && m.content.some(b => b.type === 'text')) as AssistantMessage | undefined)
    ?.content.filter(b => b.type === 'text').map(b => (b as any).text).join('') ?? '（没有文字回答）';

export const toolResults = (messages: Message[]) => messages.filter(m => m.role === 'toolResult') as Extract<Message, { role: 'toolResult' }>[];
