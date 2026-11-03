// 第 4 章实验：工具能不能让运行提前结束？
//   node labs/ch04/terminate.ts
// submit 工具返回 terminate: true，意思是“结果已经交付，不必再问模型了”。
// 只有一批工具“全部”同意终止才会终止；混着一个普通工具，就还得再问模型一次。
import type { AgentTool } from '../../mox/src/tools.ts';
import type { Script } from '../../mox/src/providers/scripted.ts';
import { runMox, runPi } from '../shared/harness.ts';

const submit: AgentTool = { name: 'submit', description: '提交最终结果', parameters: { type: 'object', properties: { answer: { type: 'string' } } }, execute: ({ answer }) => ({ content: `已提交：${answer}`, terminate: true }) };
const lookup: AgentTool = { name: 'lookup', description: '查询资料', parameters: { type: 'object', properties: {} }, execute: () => '资料：……' };

const cases: { label: string; calls: string[] }[] = [
  { label: '只调用 submit', calls: ['submit'] },
  { label: 'submit + lookup', calls: ['submit', 'lookup'] },
  { label: 'submit + submit', calls: ['submit', 'submit'] },
];

console.log('| 第一轮的工具 | mox 请求次数 | Pi 请求次数 |');
console.log('| --- | --- | --- |');
for (const c of cases) {
  const script: Script = (_ctx, n) => (n === 1 ? { toolCalls: c.calls.map(name => ({ name, arguments: name === 'submit' ? { answer: '42' } : {} })) } : { text: '好的，已经处理完。' });
  const spec = { prompt: '算一下答案并提交', script, tools: [submit, lookup] };
  const [m, p] = [await runMox(spec), await runPi(spec)];
  console.log(`| ${c.label} | ${m.requests} | ${p.requests} |`);
}
