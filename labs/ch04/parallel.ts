// 第 4 章实验：一条回复里有三个工具调用，并行执行还是串行执行？
//   node labs/ch04/parallel.ts
// 三个工具分别耗时 300、100、200 毫秒。观察：总耗时、“执行完成”事件的顺序、交给模型的结果顺序。
import type { AgentTool } from '../../mox/src/tools.ts';
import type { Script } from '../../mox/src/providers/scripted.ts';
import { runMox, runPi, toolResults } from '../shared/harness.ts';

const sleep = (ms: number, signal?: AbortSignal) => new Promise(r => setTimeout(r, ms));
const make = (name: string, ms: number, mode?: 'sequential'): AgentTool => ({
  name, description: `耗时 ${ms}ms 的查询`, parameters: { type: 'object', properties: {} },
  ...(mode ? { executionMode: mode } : {}),
  async execute(_args, { signal }) { await sleep(ms, signal); return `${name} 完成`; },
});
const script = (names: string[]): Script => (_ctx, n) =>
  n === 1 ? { toolCalls: names.map((name, i) => ({ id: name, name, arguments: {} })) } : { text: '三个都查完了。' };

const cases = [
  { label: '默认（并行）', tools: [make('a', 300), make('b', 100), make('c', 200)], mode: undefined },
  { label: '全局串行', tools: [make('a', 300), make('b', 100), make('c', 200)], mode: 'sequential' as const },
  { label: 'b 声明 sequential', tools: [make('a', 300), make('b', 100, 'sequential'), make('c', 200)], mode: undefined },
];

console.log('| 实现 | 情形 | 总耗时 | 执行完成的顺序 | 交给模型的结果顺序 |');
console.log('| --- | --- | --- | --- | --- |');
for (const c of cases) {
  for (const [label, run] of [['mox', runMox], ['Pi', runPi]] as const) {
    const start = performance.now();
    const report = await run({ prompt: '查一下 a、b、c', script: script(['a', 'b', 'c']), tools: c.tools, toolExecution: c.mode });
    const ms = Math.round((performance.now() - start) / 50) * 50;
    const finished = report.events.filter(e => e.startsWith('tool_end:')).map(e => e.slice(9)).join(' → ');
    const order = toolResults(report.messages).map(r => r.toolCallId).join(' → ');
    console.log(`| ${label} | ${c.label} | 约 ${ms}ms | ${finished} | ${order} |`);
  }
}
