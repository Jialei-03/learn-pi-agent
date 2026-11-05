// 第 1 章实验：同一个任务交给 Pi —— 真实的 runAgentLoop + Pi 自带的 ls / read 工具。
//   node labs/ch01/pi-read.ts
// 模型换成 Pi 的 faux（脚本）模型：先列目录，再读 README，最后回答。
import { PROMPT, runPi, textOf } from './pi-run.ts';

const { requests, executed, added } = await runPi();
const brief = (m: any) => (m.role === 'assistant' && m.content.some((b: any) => b.type === 'toolCall')
  ? `assistant（调用 ${m.content.filter((b: any) => b.type === 'toolCall').map((b: any) => b.name).join('、')}）` : m.role);

console.log(`用户：${PROMPT}\n`);
console.log('| 请求 | 发送的消息条数 | 消息的角色，按顺序 |\n| --- | --- | --- |');
requests.forEach((messages, i) => console.log(`| 第 ${i + 1} 次 | ${messages.length} | ${messages.map(brief).join(' → ')} |`));
console.log(`\n真正执行的工具：${executed.join('；')}`);
console.log(`最终回答：${textOf(added.findLast(m => m.role === 'assistant')!)}`);
