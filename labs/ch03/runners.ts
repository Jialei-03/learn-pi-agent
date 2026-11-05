// 第 3 章实验的共用部分：同一份脚本，三种循环。
//   v0  ：把保护全部拿掉的稻草人（只存在于这个实验里，不是另一个 Agent）
//   Pi  ：Pi 真实的 runAgentLoop，模型换成 Pi 的 faux provider
//   mox ：实战里写出来的 runLoop（由 practice.ts 通过 loadMox 传进来；默认是参考实现）
import { runAgentLoop } from '@earendil-works/pi-agent-core';
import { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { obj, str } from '@earendil-works/pi-schema';
import type { Model, Msg } from '../../mox/src/model.ts';
import { scripted } from '../shared/scripted.ts';
import { SAFETY_CAP, createWorld, scenarios, type Observation, type Scenario } from './scenarios.ts';

/** 安全阀拦下的运行不算“崩溃”，只是停不下来。 */
const crashed = (error: unknown) => ((error as Error).message.includes('安全阀') ? (error as Error).message : `崩溃：${(error as Error).message}`);
const finalText = (messages: Msg[]) => (messages.findLast(m => m.role === 'assistant' && m.content) as { content: string } | undefined)?.content ?? '（没有文字回答）';

/** 给模型加一个请求计数和安全阀：已经收到 SAFETY_CAP 条回复还要再请求，就判定停不下来。 */
function counted(model: Model) {
  const state = { requests: 0 };
  const wrapped: Model = async request => {
    if (state.requests >= SAFETY_CAP) throw new Error(`发了 ${SAFETY_CAP} 次请求仍未停止，被安全阀拦下`);
    const reply = await model(request);
    state.requests++;
    return reply;
  };
  return { model: wrapped, state };
}

// ── v0：把保护全部拿掉 ─────────────────────────────
export async function naive(scenario: Scenario): Promise<Observation> {
  const world = createWorld(scenario);
  const { model, state } = counted(scripted(scenario.script));
  const messages: Msg[] = [{ role: 'user', content: scenario.prompt }];
  try {
    while (true) {
      const { message } = await model({ messages });
      messages.push(message);
      if (!message.tool_calls?.length) break;                      // 唯一的停止条件
      for (const call of message.tool_calls) {
        const tool = world.tools.find(t => t.name === call.function.name)!;
        const output = await tool.run(JSON.parse(call.function.arguments));
        messages.push({ role: 'tool', tool_call_id: call.id, content: output });
      }
    }
    return { requests: state.requests, toolRuns: world.toolRuns, outcome: finalText(messages), install: world.files['INSTALL.md'], unread: world.steering };
  } catch (error) {
    return { requests: state.requests, toolRuns: world.toolRuns, outcome: crashed(error), install: world.files['INSTALL.md'], unread: world.steering };
  }
}

// ── mox：你写的 runLoop ───────────────────────────────────────
// hostStop = true：宿主在 onEvent 里数工具执行的次数，够数了就取消 —— mox 的循环里没有别的办法让它停
export async function mox(runLoop: (messages: Msg[], options: any) => Promise<string>, scenario: Scenario, hostStop = false): Promise<Observation> {
  const world = createWorld(scenario);
  const { model, state } = counted(scripted(scenario.script));
  const controller = new AbortController();
  const messages: Msg[] = [{ role: 'user', content: scenario.prompt }];
  let executed = 0, outcome: string;
  try {
    outcome = await runLoop(messages, {
      model, system: '', tools: world.tools, signal: controller.signal,
      steer: () => world.steering.splice(0),
      onEvent: e => { if (hostStop && e.type === 'tool_end' && ++executed >= scenario.stopAfter!) controller.abort(); },
    });
  } catch (error) {
    outcome = controller.signal.aborted ? `宿主在第 ${executed} 次工具执行后取消，runLoop 抛出 ${(error as Error).name}` : crashed(error);
  }
  return { requests: state.requests, toolRuns: world.toolRuns, outcome, install: world.files['INSTALL.md'], unread: world.steering };
}

// ── Pi：packages/agent 的 runAgentLoop ────────────────────────
const toMox = (m: any): Msg | undefined => {
  const text = (c: any) => (typeof c === 'string' ? c : c.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(''));
  if (m.role === 'user') return { role: 'user', content: text(m.content) };
  if (m.role === 'toolResult') return { role: 'tool', tool_call_id: m.toolCallId, content: (m.isError ? '错误：' : '') + text(m.content) };
  if (m.role === 'assistant') {
    const calls = m.content.filter((b: any) => b.type === 'toolCall').map((b: any) => ({ id: b.id, type: 'function' as const, function: { name: b.name, arguments: JSON.stringify(b.arguments) } }));
    return { role: 'assistant', content: text(m.content) || null, ...(calls.length ? { tool_calls: calls } : {}) };
  }
  return undefined;                                               // Pi 为声明工具插入的 system 消息，脚本不需要
};

// hostStop = true：宿主用 finishTurn 在第 stopAfter 轮结束时叫停（Pi 的专用入口）
export async function pi(scenario: Scenario, hostStop = false): Promise<Observation> {
  const world = createWorld(scenario);
  const faux = createFauxCore({});
  faux.setResponses(Array.from({ length: SAFETY_CAP + 1 }, (_, i) => (context: any) => {
    const reply = scenario.script(context.messages.map(toMox).filter(Boolean), i + 1);
    const blocks = [...(reply.text ? [fauxText(reply.text)] : []), ...(reply.toolCalls ?? []).map(c => fauxToolCall(c.name, c.arguments, { id: c.id }))];
    return fauxAssistantMessage(blocks, { stopReason: reply.finish === 'length' ? 'length' : reply.toolCalls?.length ? 'toolUse' : 'stop' });
  }));
  let requests = 0, turns = 0, capped = false;
  const controller = new AbortController();
  const piTools = world.tools.map(t => ({
    name: t.name, label: t.name, description: t.description,
    parameters: t.name === 'read' ? obj({ path: str() }) : obj({ path: str(), content: str() }),
    async execute(_id: string, args: any) {
      return { content: [{ type: 'text' as const, text: await t.run(args) }], details: undefined };
    },
  }));
  const messages = await runAgentLoop(
    [{ role: 'user', content: scenario.prompt, timestamp: 0 }],
    { messages: [], tools: piTools },
    {
      model: faux.getModel(), convertToLlm: m => m as any,
      finishTurn: async () => (hostStop && ++turns >= scenario.stopAfter! ? { action: 'end' } : undefined),
      getSteeringMessages: async () => world.steering.splice(0).map(content => ({ role: 'user' as const, content, timestamp: 1 })),
    },
    () => {}, controller.signal,
    (info, context, options) => {
      if (requests >= SAFETY_CAP) { capped = true; controller.abort(); }      // 没有宿主策略时，演示用的安全阀
      requests++;
      return faux.streamSimple(info, context, options);
    },
  );
  if (capped) requests = SAFETY_CAP;
  const outcome = capped ? `发了 ${SAFETY_CAP} 次请求仍未停止，被安全阀拦下`
    : hostStop && turns >= scenario.stopAfter! ? `宿主在第 ${turns} 轮后结束运行` : finalText(messages.map(toMox).filter(Boolean) as Msg[]);
  return { requests, toolRuns: world.toolRuns, outcome, install: world.files['INSTALL.md'], unread: world.steering };
}

export function compact(runs: string[]) {
  const groups: { run: string; count: number }[] = [];
  for (const run of runs) groups.at(-1)?.run === run ? groups.at(-1)!.count++ : groups.push({ run, count: 1 });
  return groups.map(g => (g.count > 1 ? `${g.run} ×${g.count}` : g.run)).join('，') || '无';
}
