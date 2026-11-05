// 第 4 章实验：一条回复里有三个工具调用，Pi 并行还是串行？
//   node labs/ch04/pi-parallel.ts
// 三个工具分别耗时 300、100、200 毫秒。观察：总耗时、“执行完成”事件的顺序、交给模型的结果顺序。
import assert from 'node:assert/strict';
import { runPi, type RunTool } from '../shared/harness.ts';
import type { Script } from '../shared/scripted.ts';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const make = (name: string, ms: number, mode?: 'sequential'): RunTool => ({
  name, description: `耗时 ${ms}ms 的查询`, parameters: { type: 'object', properties: {} },
  ...(mode ? { executionMode: mode } : {}),
  async run() { await sleep(ms); return `${name} 完成`; },
});
const script: Script = (_messages, n) =>
  n === 1 ? { toolCalls: ['a', 'b', 'c'].map(name => ({ id: name, name, arguments: {} })) } : { text: '三个都查完了。' };

const cases = [
  { label: '默认（并行）', run: () => runPi({ prompt: '查 a、b、c', script, tools: [make('a', 300), make('b', 100), make('c', 200)] }) },
  { label: '全局 sequential', run: () => runPi({ prompt: '查 a、b、c', script, tools: [make('a', 300), make('b', 100), make('c', 200)], toolExecution: 'sequential' }) },
  { label: 'b 声明 sequential', run: () => runPi({ prompt: '查 a、b、c', script, tools: [make('a', 300), make('b', 100, 'sequential'), make('c', 200)] }) },
];

console.log('| 情形 | 总耗时 | 执行完成的顺序 | 交给模型的结果顺序 |');
console.log('| --- | --- | --- | --- |');
const rows: Record<string, { ms: number; finished: string; order: string }> = {};
for (const c of cases) {
  const start = performance.now();
  const report = await c.run();
  const ms = Math.round((performance.now() - start) / 100) * 100;
  const finished = report.events.filter(e => e.startsWith('tool_end:')).map(e => e.slice(9)).join(' → ');
  const order = report.messages.filter(m => m.role === 'tool').map(m => (m as { tool_call_id: string }).tool_call_id).join(' → ');
  rows[c.label] = { ms, finished, order };
  console.log(`| ${c.label} | 约 ${ms}ms | ${finished} | ${order} |`);
}
assert.equal(rows['默认（并行）'].finished, 'b → c → a');
assert.ok(rows['默认（并行）'].ms <= 400 && rows['全局 sequential'].ms >= 600 && rows['b 声明 sequential'].ms >= 600);
for (const r of Object.values(rows)) assert.equal(r.order, 'a → b → c');   // 不管谁先完成，交给模型的顺序不变
