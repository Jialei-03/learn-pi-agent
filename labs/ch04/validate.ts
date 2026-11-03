// 第 4 章实验：参数校验失败时，模型能不能自己改对？
//   node labs/ch04/validate.ts
// 模型第一次把参数名写错（file 而不是 path），还把 limit 写成了字符串 "20"。
// "20" 会被自动修正成 20（宽进）；参数名写错修不了，校验失败（严出）。
// 错误信息作为工具结果交回去，模型第二次就改对了。
import type { AgentTool } from '../../mox/src/tools.ts';
import type { Script } from '../../mox/src/providers/scripted.ts';
import { runMox, runPi, toolResults, lastText } from '../shared/harness.ts';

const readFile: AgentTool = {
  name: 'read_file',
  description: '读取文件的前若干行',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' }, limit: { type: 'integer', minimum: 1 } },
    required: ['path'],
    additionalProperties: false,
  },
  execute: ({ path, limit }) => `${path} 的前 ${limit ?? '全部'} 行：# Mox Notes …`,
};

const script: Script = (ctx, n) => {
  if (n === 1) return { toolCalls: [{ name: 'read_file', arguments: { file: 'README.md', limit: '20' } }] };
  const last = ctx.messages.findLast(m => m.role === 'toolResult');
  if (n === 2 && last?.role === 'toolResult' && last.isError) return { toolCalls: [{ name: 'read_file', arguments: { path: 'README.md', limit: '20' } }] };
  return { text: '读到了：这是 Mox Notes 的说明。' };
};

for (const [label, run] of [['mox', runMox], ['Pi', runPi]] as const) {
  const report = await run({ prompt: '看看 README 的前 20 行', script, tools: [readFile] });
  const [first, second] = toolResults(report.messages);
  console.log(`━━ ${label}：${report.requests} 次请求 ━━`);
  console.log(`第一次调用的结果（isError=${first.isError}）：\n${first.content}\n`);
  console.log(`第二次调用的结果（isError=${second.isError}）：${second.content}`);
  console.log(`最终回答：${lastText(report.messages)}\n`);
}
