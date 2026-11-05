// 第 1 章实验：mox 的 model + loop + tools 就是第一个 Agent。
//   node labs/ch01/first-agent.ts
// 模型是脚本（离线、确定），循环和工具是 mox 的真实代码。每次请求前打印“这次发给模型的消息”。
import { PROMPT, runFirstAgent } from './run.ts';

const { requests, executed, answer } = await runFirstAgent();
const brief = (m: any) => (m.role === 'assistant' && m.tool_calls ? `assistant（调用 ${m.tool_calls.map((c: any) => c.function.name).join('、')}）` : m.role);

console.log(`用户：${PROMPT}\n`);
console.log('| 请求 | 发送的消息条数 | 消息的角色，按顺序 |\n| --- | --- | --- |');
requests.forEach((r, i) => console.log(`| 第 ${i + 1} 次 | ${r.messages.length} | ${r.messages.map(brief).join(' → ')} |`));
console.log(`\n程序真正执行的工具：${executed.join('；')}`);
console.log(`最终回答：${answer}`);
