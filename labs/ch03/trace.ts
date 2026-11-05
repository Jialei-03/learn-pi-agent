// 第 3 章：用 mox 的 runLoop 事件录制一次运行的回放（网站构建时调用）。
//   node labs/ch03/trace.ts truncated
import { runLoop, type Event } from '../../mox/src/loop.ts';
import type { Model, Msg } from '../../mox/src/model.ts';
import { scripted } from '../shared/scripted.ts';
import { createWorld, scenarios } from './scenarios.ts';

const name = process.argv[2] ?? 'truncated';
const scenario = scenarios[name];
const world = createWorld(scenario);

const callNames = new Map<string, string>();
const display = (m: Msg) => {
  if (m.role === 'tool') return { role: 'toolResult', name: callNames.get(m.tool_call_id), text: m.content, error: m.content.startsWith('错误：') };
  if (m.role !== 'assistant') return { role: m.role, text: m.content };
  for (const c of m.tool_calls ?? []) callNames.set(c.id, c.function.name);
  return { role: 'assistant', text: m.content ?? '', calls: (m.tool_calls ?? []).map(c => ({ name: c.function.name, args: JSON.parse(c.function.arguments) })) };
};

const shown: any[] = [];
const steps: any[] = [];
let lastRequestAt = 0;
let requests = 0;
let lastFinish = 'stop';

// 包一层模型，只为了在“请求发出前”记一笔，并记下这次回复的 finish（message 事件里没有它）
const base = scripted(scenario.script);
const model: Model = async request => {
  requests++;
  steps.push({ kind: 'request', label: `第 ${requests} 次请求`, messages: [...shown], fresh: shown.map((_, i) => i).filter(i => i >= lastRequestAt),
    explain: requests === 1 ? `用户的请求：“${scenario.prompt}”。` : '上一轮的结果已经放回历史，循环带着完整上下文再请求一次。' });
  lastRequestAt = shown.length;
  const reply = await base(request);
  lastFinish = reply.finish;
  return reply;
};

const explainAssistant = (m: Msg & { role: 'assistant' }) => {
  const call = m.tool_calls?.[0];
  if (lastFinish === 'length') return `回复的 <b>finish 是 length</b>：输出在生成 <b>${call?.function.name}</b> 的参数时撞到了上限，<code>content</code> 只有半截。参数在语法上完全合法——这正是危险所在。`;
  if (call) return `模型请求 <b>${call.function.name}</b>，这次 finish 是 <b>${lastFinish}</b>，参数完整。`;
  return `回复里没有工具请求，finish 是 <b>${lastFinish}</b>：<code>runLoop</code> 的退出条件成立，本次运行结束。`;
};
const onEvent = (e: Event) => {
  if (e.type !== 'message') return;
  shown.push(display(e.message));
  const m = e.message;
  if (m.role === 'assistant') steps.push({ kind: 'response', label: lastFinish === 'length' ? '回复被截断' : m.tool_calls?.length ? '模型请求工具' : '模型给出回答', messages: [...shown], fresh: [shown.length - 1], explain: explainAssistant(m) });
  if (m.role === 'tool') {
    const failed = m.content.startsWith('错误：');
    steps.push({ kind: 'tool', label: failed ? `${callNames.get(m.tool_call_id)} 未执行` : `执行 ${callNames.get(m.tool_call_id)}`, messages: [...shown], fresh: [shown.length - 1],
      explain: m.content.includes('被截断')
        ? '循环<b>没有调用</b> write 工具，而是直接生成一条以“错误：”开头的工具结果，告诉模型参数可能不完整。磁盘上什么都没写。'
        : failed ? '工具抛出了异常，循环把它变成一条错误结果交回给模型。' : `工具真正执行了。此刻磁盘上的 INSTALL.md：<code>${JSON.stringify(world.files['INSTALL.md'] ?? null)}</code>` });
  }
};

const history: Msg[] = [{ role: 'user', content: scenario.prompt }];
shown.push(...history.map(display));
const answer = await runLoop(history, { model, system: '', tools: world.tools, onEvent });
steps.push({ kind: 'end', label: '运行结束', messages: [...shown], fresh: [],
  explain: `<code>runLoop</code> 返回了最后的回答：“${answer}”。一共 ${requests} 次请求。最终磁盘上的 INSTALL.md 是完整的：<code>${JSON.stringify(world.files['INSTALL.md'] ?? null)}</code>` });
console.log(JSON.stringify({ title: `回放：${scenario.title}`, subtitle: 'mox/src/loop.ts · 脚本模型', steps }));
