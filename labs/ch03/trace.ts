// 第 3 章：用 mox 的 runLoop 事件录制一次运行的回放（网站构建时调用）。
//   node labs/ch03/trace.ts truncated
import { runLoop, type AgentEvent } from '../../mox/src/loop.ts';
import { scripted } from '../../mox/src/providers/scripted.ts';
import type { Message } from '../../mox/src/types.ts';
import { createWorld, scenarios } from './scenarios.ts';

const name = process.argv[2] ?? 'truncated';
const scenario = scenarios[name];
const world = createWorld(scenario);

const display = (m: Message) => {
  if (m.role === 'user') return { role: 'user', text: m.content };
  if (m.role === 'toolResult') return { role: 'toolResult', name: m.toolName, text: m.content, error: m.isError };
  const text = m.content.filter(b => b.type === 'text').map(b => (b as any).text).join('');
  const calls = m.content.filter(b => b.type === 'toolCall').map(b => ({ name: (b as any).name, args: (b as any).arguments }));
  return { role: 'assistant', text: text + (m.stopReason === 'length' ? '\n[stopReason: length —— 输出撞到长度上限]' : ''), calls };
};

const shown: any[] = [];
const steps: any[] = [];
let lastRequestAt = 0;
let requests = 0;
const explainAssistant = (m: Message & { role: 'assistant' }) => {
  const call = m.content.find(b => b.type === 'toolCall') as any;
  if (m.stopReason === 'length') return `回复的 <b>stopReason 是 length</b>：输出在生成 <b>${call?.name}</b> 的参数时撞到了上限，<code>content</code> 只有半截。参数在语法上完全合法——这正是危险所在。`;
  if (call) return `模型请求 <b>${call.name}</b>，这次 stopReason 是 <b>toolUse</b>，参数完整。`;
  return '回复里没有工具请求，stopReason 是 <b>stop</b>：内层循环的条件不再成立，本次运行结束。';
};
const onEvent = (e: AgentEvent) => {
  if (e.type === 'turn_start') {
    requests++;
    steps.push({ kind: 'request', label: `第 ${requests} 次请求`, messages: [...shown], fresh: shown.map((_, i) => i).filter(i => i >= lastRequestAt),
      explain: requests === 1 ? `用户的请求：“${scenario.prompt}”。` : '上一轮的结果已经放回历史，循环带着完整上下文再请求一次。' });
    lastRequestAt = shown.length;
  }
  if (e.type === 'message') {
    shown.push(display(e.message));
    const m = e.message;
    if (m.role === 'assistant') steps.push({ kind: 'response', label: m.stopReason === 'length' ? '回复被截断' : m.content.some(b => b.type === 'toolCall') ? '模型请求工具' : '模型给出回答', messages: [...shown], fresh: [shown.length - 1], explain: explainAssistant(m) });
    if (m.role === 'toolResult') steps.push({ kind: 'tool', label: m.isError ? `${m.toolName} 未执行` : `执行 ${m.toolName}`, messages: [...shown], fresh: [shown.length - 1],
      explain: m.isError && m.content.includes('没有执行')
        ? '循环<b>没有调用</b> write_file，而是直接生成一条 <b>isError</b> 的工具结果，告诉模型参数可能不完整。磁盘上什么都没写。'
        : m.isError ? '工具抛出了异常，循环把它变成一条 <b>isError</b> 的结果交回给模型。' : `工具真正执行了。此刻磁盘上的 INSTALL.md：<code>${JSON.stringify(world.files['INSTALL.md'] ?? null)}</code>` });
  }
  if (e.type === 'agent_end') steps.push({ kind: 'end', label: '运行结束', messages: [...shown], fresh: [],
    explain: `结束原因：<b>${e.reason}</b>。一共 ${requests} 次请求。最终磁盘上的 INSTALL.md 是完整的：<code>${JSON.stringify(world.files['INSTALL.md'] ?? null)}</code>` });
};

await runLoop([], [{ role: 'user', content: scenario.prompt }], { model: scripted(scenario.script), systemPrompt: '', tools: world.tools, onEvent });
console.log(JSON.stringify({ title: `回放：${scenario.title}`, subtitle: 'mox/src/loop.ts · 脚本模型', steps }));
