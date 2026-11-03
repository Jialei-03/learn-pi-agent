// 第 1 章：把一次运行录成可交互的回放（网站构建时调用，输出 JSON）。
//   node labs/ch01/trace.ts
import { fileURLToPath } from 'node:url';
import { SYSTEM, runAgent, tools, type ChatMessage } from '../../mox/stage-01/agent.ts';
import { scriptedModel } from '../../mox/stage-01/scripted-model.ts';

process.chdir(fileURLToPath(new URL('../fixtures/mox-project/', import.meta.url)));
const snapshots: ChatMessage[][] = [];
const { messages } = await runAgent('这个项目是做什么的？', scriptedModel, sent => snapshots.push(sent));

const names = new Map<string, string>();
const display = (m: ChatMessage) => {
  if (m.role === 'assistant') {
    for (const c of m.tool_calls ?? []) names.set(c.id, c.function.name);
    return { role: 'assistant', text: m.content ?? '', calls: (m.tool_calls ?? []).map((c: any) => ({ name: c.function.name, args: JSON.parse(c.function.arguments) })) };
  }
  if (m.role === 'tool') return { role: 'toolResult', name: names.get(m.tool_call_id), text: m.content };
  return { role: m.role, text: m.content };
};
const shown = messages.map(display);
const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);

const steps: any[] = [];
snapshots.forEach((sent, i) => {
  const before = i === 0 ? 0 : snapshots[i - 1].length;
  steps.push({
    kind: 'request', label: `第 ${i + 1} 次请求`, messages: shown.slice(0, sent.length), fresh: range(before, sent.length),
    explain: i === 0
      ? '用户提问后，程序把 <b>system + user</b> 两条消息和两个工具的说明一起发给模型。模型此时还没看到任何文件。'
      : `再次请求时发送的是<b>全部历史</b>（${sent.length} 条），而不只是新增的那条工具结果——模型的 API 不保存任何状态。`,
    wire: { model: 'gpt-4o-mini', messages: sent, tools }, wireLabel: 'OpenAI Chat Completions',
  });
  const reply = shown[sent.length];
  steps.push({
    kind: 'response', label: reply.calls?.length ? `模型请求 ${reply.calls[0].name}` : '模型给出回答', messages: shown.slice(0, sent.length + 1), fresh: [sent.length],
    explain: reply.calls?.length
      ? `模型没有“读文件”的能力，它只是返回了一段结构化的请求：<b>${reply.calls[0].name}(${JSON.stringify(reply.calls[0].args)})</b>。要不要执行、怎么执行，由我们的程序决定。`
      : '这次回复里没有工具调用——循环据此判断任务结束，把文字交给用户。',
  });
  const next = snapshots[i + 1]?.length ?? shown.length;
  for (const j of range(sent.length + 1, next)) {
    steps.push({
      kind: 'tool', label: `执行 ${shown[j].name}`, messages: shown.slice(0, j + 1), fresh: [j],
      explain: `程序调用了本地函数 <b>${shown[j].name}</b>，把返回的文本包装成一条 <b>tool</b> 消息追加到历史末尾，用 <code>tool_call_id</code> 对应到刚才的请求。`,
    });
  }
});
steps.push({ kind: 'end', label: '运行结束', messages: shown, fresh: [], explain: `一共 <b>${snapshots.length} 次</b>模型请求、<b>${shown.filter(m => m.role === 'toolResult').length} 次</b>工具执行。用户只问了一句话，背后是一个“请求 → 执行 → 再请求”的循环。` });

console.log(JSON.stringify({ title: '一次运行的完整回放', subtitle: '脚本模型 · mox/stage-01/agent.ts · 点击左侧步骤或“下一步”', steps }));
