// 第 4 章实验：工具能不能让运行提前结束？
//   node labs/ch04/terminate.ts
// submit 工具返回 terminate: true，意思是“结果已经交付，不必再问模型了”。
// Pi 的规则：一批工具“全部”同意终止才会终止；混着一个普通工具，就还得再问模型一次。
// mox 没有这个概念：工具只能返回字符串，runLoop 在有工具调用的一轮之后一定会再请求一次模型。
import assert from 'node:assert/strict';
import { runMox, runPi, type RunTool } from '../shared/harness.ts';
import type { Script } from '../shared/scripted.ts';

const submit: RunTool = { name: 'submit', description: '提交最终结果', parameters: { type: 'object', properties: { answer: { type: 'string' } } }, run: ({ answer }) => ({ content: `已提交：${answer}`, terminate: true }) };
const lookup: RunTool = { name: 'lookup', description: '查询资料', parameters: { type: 'object', properties: {} }, run: () => '资料：……' };

const cases: { label: string; calls: string[] }[] = [
  { label: '只调用 submit', calls: ['submit'] },
  { label: 'submit + lookup', calls: ['submit', 'lookup'] },
  { label: 'submit + submit', calls: ['submit', 'submit'] },
];

console.log('| 第一轮的工具 | mox 请求次数 | Pi 请求次数 |');
console.log('| --- | --- | --- |');
for (const c of cases) {
  const script: Script = (_messages, n) => (n === 1 ? { toolCalls: c.calls.map(name => ({ name, arguments: name === 'submit' ? { answer: '42' } : {} })) } : { text: '好的，已经处理完。' });
  const spec = { prompt: '算一下答案并提交', script, tools: [submit, lookup] };
  const [m, p] = [await runMox(spec), await runPi(spec)];
  console.log(`| ${c.label} | ${m.requests} | ${p.requests} |`);
  assert.equal(m.requests, 2);                                       // mox 没有终止：工具一跑完就再问一次模型
  assert.equal(p.requests, c.calls.every(n => n === 'submit') ? 1 : 2);
}
