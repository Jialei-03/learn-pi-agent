// 第 1 章：把一次运行录成可交互的回放（网站构建时调用，输出 JSON）。
//   node labs/ch01/trace.ts          脚本模型，离线
//   node labs/ch01/trace.ts real     真实 MiniMax 运行（读 recorded/first-run.json）
import { readFileSync } from 'node:fs';
import type { Msg } from '../../mox/src/model.ts';
import { codingTools } from '../../mox/src/tools.ts';
import { SYSTEM, PROMPT, cwd, runFirstAgent } from './run.ts';

const real = process.argv[2] === 'real';
type Sent = Msg[];
const specs = codingTools(cwd).map(({ name, description, parameters }) => ({ type: 'function', function: { name, description, parameters } }));
let history: Msg[], sentCounts: number[], system: string, title: string, subtitle: string;
if (real) {
  const record = JSON.parse(readFileSync(new URL('./recorded/first-run.json', import.meta.url), 'utf8'));
  history = record.messages; system = record.system;
  sentCounts = record.requests.map((r: any) => r.messages);
  title = '真实模型的一次运行'; subtitle = `${record.model} · ${record.captured_at} 录制 · mox 的 runLoop 与 codingTools`;
} else {
  const run = await runFirstAgent();
  history = run.messages; system = SYSTEM;
  sentCounts = run.requests.map(r => r.messages.length);
  title = '一次运行的完整回放'; subtitle = '脚本模型 · mox 的 runLoop 与 codingTools · 点击左侧步骤或“下一步”';
}

const names = new Map<string, string>();
const display = (m: Msg) => {
  if (m.role === 'assistant') {
    for (const c of m.tool_calls ?? []) names.set(c.id, c.function.name);
    return { role: 'assistant', text: m.content ?? '', calls: (m.tool_calls ?? []).map(c => ({ name: c.function.name, args: JSON.parse(c.function.arguments) })) };
  }
  if (m.role === 'tool') return { role: 'toolResult', name: names.get(m.tool_call_id), text: m.content };
  return { role: m.role, text: m.content };
};
const shown = history.map(display);
const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);

const steps: any[] = [];
sentCounts.forEach((count, i) => {
  const sentLength = count - 1;                                 // 去掉请求最前面的 system
  const before = i === 0 ? 0 : sentCounts[i - 1] - 1;
  const sent: Sent = [{ role: 'system', content: system }, ...history.slice(0, sentLength)];
  steps.push({
    kind: 'request', label: `第 ${i + 1} 次请求`, messages: shown.slice(0, sentLength), fresh: range(before, sentLength),
    explain: i === 0
      ? '用户提问后，<code>runLoop</code> 把 <b>system + user</b> 两条消息和工具说明一起发给模型。模型此时还没看到任何文件。'
      : `再次请求时发送的是<b>全部历史</b>（${count} 条，含最前面的 system），而不只是新增的那几条工具结果——模型的 API 不保存任何状态。`,
    wire: { model: real ? 'MiniMax-M3.1-Flash' : 'scripted', messages: sent, stream: true, ...(specs.length ? { tools: specs } : {}) }, wireLabel: 'OpenAI Chat Completions',
  });
  const reply = shown[sentLength];
  const calls = (reply as any).calls ?? [];
  steps.push({
    kind: 'response', label: calls.length ? `模型请求 ${calls.map((c: any) => c.name).join('、')}` : '模型给出回答', messages: shown.slice(0, sentLength + 1), fresh: [sentLength],
    explain: calls.length
      ? `模型没有“读文件”的能力，它只是返回了结构化的请求：${calls.map((c: any) => `<b>${c.name}(${JSON.stringify(c.args)})</b>`).join('、')}。要不要执行、怎么执行，由 mox 的程序决定。`
      : '这次回复里没有工具调用——循环据此判断任务结束，把文字交给用户。',
  });
  const next = i + 1 < sentCounts.length ? sentCounts[i + 1] - 1 : shown.length;
  for (const j of range(sentLength + 1, next)) {
    steps.push({
      kind: 'tool', label: `执行 ${shown[j].name}`, messages: shown.slice(0, j + 1), fresh: [j],
      explain: `程序调用了本地的 <b>${shown[j].name}</b> 工具，把返回的文本包装成一条 <b>tool</b> 消息追加到历史末尾，用 <code>tool_call_id</code> 对应到刚才的请求。${calls.length > 1 ? '同一条回复里的多个调用<b>按顺序</b>一个个执行。' : ''}`,
    });
  }
});
steps.push({ kind: 'end', label: '运行结束', messages: shown, fresh: [], explain: `一共 <b>${sentCounts.length} 次</b>模型请求、<b>${shown.filter(m => m.role === 'toolResult').length} 次</b>工具执行。用户只问了一句话（“${PROMPT}”），背后是一个“请求 → 执行 → 再请求”的循环。` });

console.log(JSON.stringify({ title, subtitle, steps }));
