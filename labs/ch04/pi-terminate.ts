// 第 4 章实验：Pi 的工具能不能让运行提前结束？
//   node labs/ch04/pi-terminate.ts
// submit 工具返回 terminate: true，意思是“结果已经交付，不必再问模型了”。
// 一批工具“全部”同意终止才会终止；混着一个普通工具，就还得再问模型一次。
import assert from 'node:assert/strict';
import { runPi, type RunTool } from '../shared/harness.ts';
import type { Script } from '../shared/scripted.ts';

const submit: RunTool = { name: 'submit', description: '提交最终结果', parameters: { type: 'object', properties: { answer: { type: 'string' } } }, run: ({ answer }) => ({ content: `已提交：${answer}`, terminate: true }) };
const lookup: RunTool = { name: 'lookup', description: '查询资料', parameters: { type: 'object', properties: {} }, run: () => '资料：……' };

console.log('| 第一轮的工具 | 请求次数 | 最后一条消息 |');
console.log('| --- | --- | --- |');
for (const c of [{ label: '只调用 submit', calls: ['submit'] }, { label: 'submit + lookup', calls: ['submit', 'lookup'] }, { label: 'submit + submit', calls: ['submit', 'submit'] }]) {
  const script: Script = (_messages, n) => (n === 1 ? { toolCalls: c.calls.map(name => ({ name, arguments: name === 'submit' ? { answer: '42' } : {} })) } : { text: '好的，已经处理完。' });
  const report = await runPi({ prompt: '算一下答案并提交', script, tools: [submit, lookup] });
  const last = report.messages.at(-1)!;
  console.log(`| ${c.label} | ${report.requests} | ${last.role === 'tool' ? '工具结果（没有再问模型）' : '模型的文字回答'} |`);
  assert.equal(report.requests, c.calls.every(n => n === 'submit') ? 1 : 2);
}
