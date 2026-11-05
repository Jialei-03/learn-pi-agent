// 第 4 章实验：一条回复里有三个工具调用，并行执行还是串行执行？
//   node labs/ch04/parallel.ts
// 三个工具分别耗时 300、100、200 毫秒。观察：总耗时、“执行完成”事件的顺序、交给模型的结果顺序。
//   mox          ：runLoop 里是 for + await，一个接一个
//   mox + 参考实现：labs/ch04/parallel-loop.ts，先依次准备、再同时执行
//   Pi 默认       ：并行；toolExecution 设成 sequential，或者某个工具声明 sequential，整批串行
import assert from 'node:assert/strict';
import { runLoopParallel } from './parallel-loop.ts';
import { runMox, runPi, type RunTool } from '../shared/harness.ts';
import type { Script } from '../shared/scripted.ts';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const make = (name: string, ms: number, mode?: 'sequential'): RunTool => ({
  name, description: `耗时 ${ms}ms 的查询`, parameters: { type: 'object', properties: {} },
  ...(mode ? { executionMode: mode } : {}),
  async run() { await sleep(ms); return `${name} 完成`; },
});
const script: Script = (_messages, n) =>
  n === 1 ? { toolCalls: ['a', 'b', 'c'].map(name => ({ id: name, name, arguments: {} })) } : { text: '三个都查完了。' };

const tools = () => [make('a', 300), make('b', 100), make('c', 200)];
const cases = [
  { label: 'mox（runLoop）', run: () => runMox({ prompt: '查 a、b、c', script, tools: tools() }) },
  { label: 'mox + 并行参考实现', run: () => runMox({ prompt: '查 a、b、c', script, tools: tools(), loop: runLoopParallel }) },
  { label: 'Pi 默认（并行）', run: () => runPi({ prompt: '查 a、b、c', script, tools: tools() }) },
  { label: 'Pi 全局 sequential', run: () => runPi({ prompt: '查 a、b、c', script, tools: tools(), toolExecution: 'sequential' }) },
  { label: 'Pi，b 声明 sequential', run: () => runPi({ prompt: '查 a、b、c', script, tools: [make('a', 300), make('b', 100, 'sequential'), make('c', 200)] }) },
];

const rows: Record<string, { ms: number; finished: string; order: string }> = {};
console.log('| 实现 | 总耗时 | 执行完成的顺序 | 交给模型的结果顺序 |');
console.log('| --- | --- | --- | --- |');
for (const c of cases) {
  const start = performance.now();
  const report = await c.run();
  const ms = Math.round((performance.now() - start) / 100) * 100;
  const finished = report.events.filter(e => e.startsWith('tool_end:')).map(e => e.slice(9)).join(' → ');
  const order = report.messages.filter(m => m.role === 'tool').map(m => (m as { tool_call_id: string }).tool_call_id).join(' → ');
  console.log(`| ${c.label} | 约 ${ms}ms | ${finished} | ${order} |`);
  rows[c.label] = { ms, finished, order };
}
assert.equal(rows['mox（runLoop）'].finished, 'a → b → c');          // mox 串行：按调用顺序一个接一个完成
assert.ok(rows['mox（runLoop）'].ms >= 600 && rows['Pi 默认（并行）'].ms <= 400);
assert.equal(rows['mox + 并行参考实现'].finished, 'b → c → a');
for (const r of Object.values(rows)) assert.equal(r.order, 'a → b → c');   // 不管谁先完成，交给模型的顺序不变
