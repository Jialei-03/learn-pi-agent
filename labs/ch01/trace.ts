// 第 1 章：把 Pi 的一次运行录成可交互的回放（网站构建时调用，输出 JSON）。
//   node labs/ch01/trace.ts
import { PROMPT, runPi, textOf } from './pi-run.ts';

const { requests, added } = await runPi();
const full: any[] = [requests.at(-1)![0], ...requests.at(-1)!.slice(1), added.at(-1)];   // 最后一次请求的上下文 + 最终回答
const names = new Map<string, string>();
const display = (m: any) => {
  if (m.role === 'system') return { role: 'system', text: `（系统消息：声明了可用的工具 ${(m.toolsAdded ?? []).map((t: any) => t.name).join('、')}）` };
  if (m.role === 'assistant') {
    const calls = m.content.filter((b: any) => b.type === 'toolCall');
    for (const c of calls) names.set(c.id, c.name);
    return { role: 'assistant', text: textOf(m), calls: calls.map((c: any) => ({ name: c.name, args: c.arguments })) };
  }
  if (m.role === 'toolResult') return { role: 'toolResult', name: m.toolName, text: textOf(m) };
  return { role: m.role, text: textOf(m) };
};
const shown = full.map(display);
const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);

const steps: any[] = [];
requests.forEach((sent, i) => {
  const before = i === 0 ? 0 : requests[i - 1].length;
  steps.push({
    kind: 'request', label: `第 ${i + 1} 次请求`, messages: shown.slice(0, sent.length), fresh: range(before, sent.length),
    explain: i === 0
      ? '用户提问后，<code>runLoop</code> 把<b>系统消息（含工具声明）和 user 消息</b>一起交给模型层。模型此时还没看到任何文件。'
      : `再次请求时交出去的是<b>全部历史</b>（${sent.length} 条），而不只是新增的那条工具结果——模型的 API 不保存任何状态。`,
    wire: { messages: sent }, wireLabel: 'Pi 的内部消息（交给适配器翻译之前）',
  });
  const reply = shown[sent.length];
  steps.push({
    kind: 'response', label: reply.calls?.length ? `模型请求 ${reply.calls[0].name}` : '模型给出回答', messages: shown.slice(0, sent.length + 1), fresh: [sent.length],
    explain: reply.calls?.length
      ? `模型没有“读文件”的能力，它只是返回了一段结构化的请求：<b>${reply.calls[0].name}(${JSON.stringify(reply.calls[0].args)})</b>。要不要执行、怎么执行，由 Pi 的 <code>executeToolCalls</code> 决定。`
      : '这次回复里没有工具调用——循环据此判断任务结束，把文字交给用户。',
  });
  const next = requests[i + 1]?.length ?? shown.length;
  for (const j of range(sent.length + 1, next)) {
    steps.push({
      kind: 'tool', label: `执行 ${shown[j].name}`, messages: shown.slice(0, j + 1), fresh: [j],
      explain: `Pi 调用了本地工具 <b>${shown[j].name}</b>，把返回的文本包装成一条 <b>toolResult</b> 消息追加到历史末尾，用 <code>toolCallId</code> 对应到刚才的请求。`,
    });
  }
});
steps.push({ kind: 'end', label: '运行结束', messages: shown, fresh: [], explain: `一共 <b>${requests.length} 次</b>模型请求、<b>${shown.filter(m => m.role === 'toolResult').length} 次</b>工具执行。用户只问了一句话（“${PROMPT}”），背后是一个“请求 → 执行 → 再请求”的循环。` });

console.log(JSON.stringify({ title: 'Pi 的一次运行', subtitle: 'faux 模型 · Pi 的 runAgentLoop 与 ls / read 工具 · 点击左侧步骤或“下一步”', steps }));
