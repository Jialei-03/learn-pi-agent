// 第 3 章实验：插话（steering）和追加任务（follow-up）分别在哪一次请求里被模型看到。
//   node labs/ch03/queues.ts
// 场景：用户让 Agent 读 README。读文件的过程中，用户同时
//   - 插了一句 S：“只用一句话回答”（steering）
//   - 追加了一个任务 F：“再列出 src 目录”（follow-up）
// 模型的每次回复都会说出“我这次看到了哪几条用户消息”。
import { runAgentLoop } from '@earendil-works/pi-agent-core';
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { obj, str } from '@earendil-works/pi-schema';
import { runLoop } from '../../mox/src/loop.ts';
import { scripted } from '../../mox/src/providers/scripted.ts';
import type { Message, UserMessage } from '../../mox/src/types.ts';

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
  const steering: UserMessage[] = [];
  const followUp: UserMessage[] = [];
  const seen: string[] = [];
  const model = scripted((ctx, n) => {
    const texts = ctx.messages.filter(m => m.role === 'user').map(m => (m as UserMessage).content);
    seen.push(texts.map(short).join(' '));
    const r = reply(texts, n);
    return r.tool ? { toolCalls: [{ name: 'read_file', arguments: { path: 'README.md' } }] } : { text: r.text };
  });
  const tools = [{
    name: 'read_file', description: '读文件', parameters: {},
    execute() {
      steering.push({ role: 'user', content: S });                     // 工具运行期间，用户插话
      followUp.push({ role: 'user', content: F });                     // 同时追加一个任务
      return '# Mox Notes';
    },
  }];
  const { messages } = await runLoop([], [{ role: 'user', content: U }], {
    model, systemPrompt: '', tools,
    getSteering: () => steering.splice(0),
    getFollowUp: () => followUp.splice(0),
  });
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
      ? fauxAssistantMessage(fauxToolCall('read_file', { path: 'README.md' }, { id: 'read-1' }), { stopReason: 'toolUse' })
      : fauxAssistantMessage(r.text);
  }));
  const tool = {
    name: 'read_file', label: 'read_file', description: '读文件', parameters: obj({ path: str() }),
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
  return { seen, order: added.filter((m: any) => m.role !== 'system').map((m: any) => describe({ ...m, content: m.role === 'assistant' ? m.content : textOf(m.content) })) };
}

function describe(m: Message | any): string {
  if (m.role === 'user') return short(m.content);
  if (m.role === 'toolResult') return 'R';
  const call = m.content.find((b: any) => b.type === 'toolCall');
  return call ? 'A(read)' : 'A';
}

for (const [label, run] of [['mox', withMox], ['Pi', withPi]] as const) {
  const { seen, order } = await run();
  console.log(`── ${label} ──`);
  seen.forEach((s, i) => console.log(`  第 ${i + 1} 次请求时，模型看到的用户消息：${s}`));
  console.log(`  本次运行新增的消息顺序：${order.join(' → ')}\n`);
}
