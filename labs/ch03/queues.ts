// 第 3 章实验：插话（steering）和追加任务（follow-up）分别在哪一次请求里被模型看到。
//   node labs/ch03/queues.ts
// 场景：用户让 Agent 读 README。读文件的过程中，用户同时
//   - 插了一句 S：“只用一句话回答”（steering）
//   - 追加了一个任务 F：“再列出 src 目录”（follow-up）
// 模型的每次回复都会说出“我这次看到了哪几条用户消息”。
//
// mox 的 runLoop 只有 steer 一个队列。追加任务在循环外面：命令行（cli.ts 第 124-132 行）在 runLoop 返回后
// 问扩展的 agent_end 事件“还有下一句吗”，有就把它当新的用户消息，再调一次 runLoop。这里原样照做，
// 并且真的用 loadExtensions 装一个 agent_end 扩展。
import { runAgentLoop } from '@earendil-works/pi-agent-core';
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { obj, str } from '@earendil-works/pi-schema';
import { loadExtensions } from '../../mox/src/extensions.ts';
import { runLoop, type Tool } from '../../mox/src/loop.ts';
import type { Msg } from '../../mox/src/model.ts';
import { scripted } from '../shared/scripted.ts';

const U = '读取 README.md，介绍这个项目';
const S = '只用一句话回答';
const F = '再列出 src 目录';
const short = (t: string) => (t === U ? 'U' : t === S ? 'S' : t === F ? 'F' : '?');

/** 与实现无关的脚本：第 1 次读文件，之后每次都报告自己看到了哪些用户消息。 */
function reply(userTexts: string[], n: number) {
  if (n === 1) return { tool: true, text: '' };
  return { tool: false, text: `第 ${n} 次请求，看到用户消息 ${userTexts.map(short).join('、')}` };
}

async function withMox() {
  const steering: string[] = [];
  const followUp: string[] = [];
  const seen: string[] = [];
  const model = scripted((messages, n) => {
    const texts = messages.filter(m => m.role === 'user').map(m => m.content as string);
    seen.push(texts.map(short).join(' '));
    const r = reply(texts, n);
    return r.tool ? { toolCalls: [{ name: 'read', arguments: { path: 'README.md' } }] } : { text: r.text };
  });
  const tools: Tool[] = [{
    name: 'read', description: '读文件', parameters: { type: 'object', properties: { path: { type: 'string' } } },
    run() {
      steering.push(S);                                                // 工具运行期间，用户插话
      followUp.push(F);                                                // 同时追加一个任务
      return '# Mox Notes';
    },
  }];
  // 扩展：Agent 准备停下时，如果还有追加的任务，就把它作为下一句话
  const extensions = await loadExtensions([mox => mox.on('agent_end', () => followUp.shift())], { cwd: '.', tools, ask: async () => undefined });
  const messages: Msg[] = [];
  let text: string | undefined = U;
  while (text) {                                                       // 这几行就是 cli.ts 的 run()
    messages.push({ role: 'user', content: text });
    const final = await runLoop(messages, { model, system: '', tools, steer: () => steering.splice(0) });
    text = extensions.text(await extensions.emit('agent_end', final));
  }
  return { seen, order: messages.map(describe) };
}

async function withPi() {
  const steering: any[] = [];
  const followUp: any[] = [];
  const seen: string[] = [];
  const faux = createFauxCore({});
  const textOf = (c: any) => (typeof c === 'string' ? c : c.map((b: any) => b.text ?? '').join(''));
  faux.setResponses(Array.from({ length: 6 }, (_, i) => (context: any) => {
    const texts = context.messages.filter((m: any) => m.role === 'user').map((m: any) => textOf(m.content));
    seen.push(texts.map(short).join(' '));
    const r = reply(texts, i + 1);
    return r.tool
      ? fauxAssistantMessage(fauxToolCall('read', { path: 'README.md' }, { id: 'read-1' }), { stopReason: 'toolUse' })
      : fauxAssistantMessage(r.text);
  }));
  const tool = {
    name: 'read', label: 'read', description: '读文件', parameters: obj({ path: str() }),
    async execute() {
      steering.push({ role: 'user', content: S, timestamp: 1 });
      followUp.push({ role: 'user', content: F, timestamp: 2 });
      return { content: [{ type: 'text' as const, text: '# Mox Notes' }], details: undefined };
    },
  };
  const added = await runAgentLoop(
    [{ role: 'user', content: U, timestamp: 0 }],
    { messages: [], tools: [tool] },
    {
      model: faux.getModel(), convertToLlm: m => m as any,
      getSteeringMessages: async () => steering.splice(0),
      getFollowUpMessages: async () => followUp.splice(0),
    },
    () => {}, undefined,
    (m, c, o) => faux.streamSimple(m, c, o),
  );
  return { seen, order: added.filter((m: any) => m.role !== 'system').map((m: any) => describe({ ...m, content: m.role === 'user' ? textOf(m.content) : m.content, tool_calls: m.content?.some?.((b: any) => b.type === 'toolCall') ? [1] : undefined, role: m.role === 'toolResult' ? 'tool' : m.role })) };
}

function describe(m: any): string {
  if (m.role === 'user') return short(m.content);
  if (m.role === 'tool') return 'R';
  return m.tool_calls?.length ? 'A(read)' : 'A';
}

for (const [label, run] of [['mox', withMox], ['Pi', withPi]] as const) {
  const { seen, order } = await run();
  console.log(`── ${label} ──`);
  seen.forEach((s, i) => console.log(`  第 ${i + 1} 次请求时，模型看到的用户消息：${s}`));
  console.log(`  本次运行新增的消息顺序：${order.join(' → ')}\n`);
}
