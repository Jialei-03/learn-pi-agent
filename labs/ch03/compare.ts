// 第 3 章实验：同一份脚本，三种循环。
//   node labs/ch03/compare.ts            全部情形
//   node labs/ch03/compare.ts truncated  只跑一个
import { runAgentLoop } from '@earendil-works/pi-agent-core';
import { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { obj, str } from '@earendil-works/pi-schema';
import { runLoop } from '../../mox/src/loop.ts';
import { scripted } from '../../mox/src/providers/scripted.ts';
import type { AssistantMessage, Message, Model, ToolCall } from '../../mox/src/types.ts';
import { SAFETY_CAP, createWorld, scenarios, type Observation, type Scenario } from './scenarios.ts';

const finalText = (messages: Message[]) =>
  (messages.findLast(m => m.role === 'assistant' && m.content.some(b => b.type === 'text')) as AssistantMessage | undefined)
    ?.content.find(b => b.type === 'text')?.['text' as never] ?? '（没有文字回答）';

/** 给模型加一个请求计数和安全阀。 */
function counted(model: Model) {
  const state = { requests: 0 };
  const wrapped: Model = {
    id: model.id,
    async stream(context, options) {
      if (state.requests >= SAFETY_CAP) throw new Error(`发了 ${SAFETY_CAP} 次请求仍未停止，被安全阀拦下`);
      state.requests++;
      return model.stream(context, options);
    },
  };
  return { model: wrapped, state };
}

// ── v0：第 1 章那样的朴素循环 ─────────────────────────────────
async function naive(scenario: Scenario): Promise<Observation> {
  const world = createWorld(scenario);
  const { model, state } = counted(scripted(scenario.script));
  const messages: Message[] = [{ role: 'user', content: scenario.prompt }];
  try {
    while (true) {
      const reply = await model.stream({ systemPrompt: '', messages, tools: world.tools });
      messages.push(reply);
      const calls = reply.content.filter((b): b is ToolCall => b.type === 'toolCall');
      if (calls.length === 0) break;                               // 唯一的停止条件
      for (const c of calls) {
        const output = await world.tools.find(t => t.name === c.name)!.execute(c.arguments, { toolCallId: c.id });
        messages.push({ role: 'toolResult', toolCallId: c.id, toolName: c.name, content: output, isError: false });
      }
    }
    return { requests: state.requests, toolRuns: world.toolRuns, outcome: finalText(messages), install: world.files['INSTALL.md'], unread: world.steering };
  } catch (error) {
    return { requests: state.requests, toolRuns: world.toolRuns, outcome: `崩溃：${(error as Error).message}`, install: world.files['INSTALL.md'], unread: world.steering };
  }
}

// ── mox：第 3 章的 runLoop ────────────────────────────────────
async function mox(scenario: Scenario): Promise<Observation> {
  const world = createWorld(scenario);
  const { model, state } = counted(scripted(scenario.script));
  const { reason, messages } = await runLoop([], [{ role: 'user', content: scenario.prompt }], {
    model, systemPrompt: '', tools: world.tools,
    finishTurn: ({ turn }) => (scenario.maxTurns && turn >= scenario.maxTurns ? 'end' : undefined),
    getSteering: () => world.steering.splice(0).map(content => ({ role: 'user' as const, content })),
  });
  const outcome = reason === 'host' ? `宿主在第 ${state.requests} 轮后结束运行` : finalText(messages);
  return { requests: state.requests, toolRuns: world.toolRuns, outcome, install: world.files['INSTALL.md'], unread: world.steering };
}

// ── Pi：packages/agent 的 runAgentLoop ────────────────────────
const toMox = (m: any): Message | undefined => {
  const text = (c: any) => (typeof c === 'string' ? c : c.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(''));
  if (m.role === 'user') return { role: 'user', content: text(m.content) };
  if (m.role === 'toolResult') return { role: 'toolResult', toolCallId: m.toolCallId, toolName: m.toolName, content: text(m.content), isError: m.isError };
  if (m.role === 'assistant') return { ...m, content: m.content.filter((b: any) => b.type !== 'thinking') };
  return undefined;                                               // Pi 为声明工具插入的 system 消息，脚本不需要
};

async function pi(scenario: Scenario): Promise<Observation> {
  const world = createWorld(scenario);
  const faux = createFauxCore({});
  faux.setResponses(Array.from({ length: SAFETY_CAP }, (_, i) => (context: any) => {
    const reply = scenario.script({ systemPrompt: '', tools: [], messages: context.messages.map(toMox).filter(Boolean) }, i + 1);
    const blocks = [...(reply.text ? [fauxText(reply.text)] : []), ...(reply.toolCalls ?? []).map(c => fauxToolCall(c.name, c.arguments, { id: c.id }))];
    return fauxAssistantMessage(blocks, { stopReason: reply.stopReason ?? (reply.toolCalls?.length ? 'toolUse' : 'stop') });
  }));
  let requests = 0;
  let turns = 0;
  const piTools = world.tools.map(t => ({
    name: t.name, label: t.name, description: t.description,
    parameters: t.name === 'read_file' ? obj({ path: str() }) : obj({ path: str(), content: str() }),
    async execute(id: string, args: any) {
      return { content: [{ type: 'text' as const, text: await t.execute(args, { toolCallId: id }) }], details: undefined };
    },
  }));
  const messages = await runAgentLoop(
    [{ role: 'user', content: scenario.prompt, timestamp: 0 }],
    { messages: [], tools: piTools },
    {
      model: faux.getModel(), convertToLlm: m => m as any,
      finishTurn: async () => (scenario.maxTurns && ++turns >= scenario.maxTurns ? { action: 'end' } : undefined),
      getSteeringMessages: async () => world.steering.splice(0).map(content => ({ role: 'user' as const, content, timestamp: 1 })),
    },
    () => {}, undefined,
    (info, context, options) => { requests++; return faux.streamSimple(info, context, options); },
  );
  const outcome = scenario.maxTurns && turns >= scenario.maxTurns ? `宿主在第 ${turns} 轮后结束运行` : finalText(messages.map(toMox).filter(Boolean) as Message[]);
  return { requests, toolRuns: world.toolRuns, outcome, install: world.files['INSTALL.md'], unread: world.steering };
}

// ── 打印 ─────────────────────────────────────────────────────
function compact(runs: string[]) {
  const groups: { run: string; count: number }[] = [];
  for (const run of runs) groups.at(-1)?.run === run ? groups.at(-1)!.count++ : groups.push({ run, count: 1 });
  return groups.map(g => (g.count > 1 ? `${g.run} ×${g.count}` : g.run)).join('，') || '无';
}

export async function compareAll(names = Object.keys(scenarios)) {
  const out: Record<string, Record<string, Observation>> = {};
  for (const name of names) out[name] = { v0: await naive(scenarios[name]), mox: await mox(scenarios[name]), Pi: await pi(scenarios[name]) };
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pick = process.argv[2];
  if (pick && !scenarios[pick]) throw new Error(`未知情形：${pick}。可选：${Object.keys(scenarios).join('、')}`);
  const all = await compareAll(pick ? [pick] : undefined);
  for (const [name, cols] of Object.entries(all)) {
    console.log(`\n## ${scenarios[name].title}\n`);
    const rows: [string, (o: Observation) => string][] = [
      ['模型请求次数', o => String(o.requests)],
      ['工具实际执行', o => compact(o.toolRuns)],
      ['结局', o => o.outcome],
    ];
    if (Object.values(cols).some(o => o.install !== undefined)) rows.push(['磁盘上的 INSTALL.md', o => JSON.stringify(o.install ?? null)]);
    if (Object.values(cols).some(o => o.unread.length)) rows.push(['没被读到的插话', o => o.unread.join('，') || '无']);
    console.log(`| | v0 | mox | Pi |\n| --- | --- | --- | --- |`);
    for (const [label, pick] of rows) console.log(`| ${label} | ${Object.values(cols).map(pick).join(' | ')} |`);
  }
}
