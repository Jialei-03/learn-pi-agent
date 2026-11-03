// 第 1 章实验：同一个任务交给 Pi —— 真实的 runAgentLoop + Pi 自带的 ls / read 工具。
//   node labs/ch01/pi-read.ts
// 模型换成 Pi 的 faux（脚本）模型，决策与 mox/stage-01 的脚本模型相同：先列目录，再读 README，最后回答。
import { fileURLToPath } from 'node:url';
import { runAgentLoop } from '@earendil-works/pi-agent-core';
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { createLsTool, createReadTool } from '@earendil-works/pi-coding-agent';

const cwd = fileURLToPath(new URL('../fixtures/mox-project/', import.meta.url));
const faux = createFauxCore({});
const textOf = (m: any) => m.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
faux.setResponses([
  () => fauxAssistantMessage(fauxToolCall('ls', { path: '.' }, { id: 'call_1' }), { stopReason: 'toolUse' }),
  () => fauxAssistantMessage(fauxToolCall('read', { path: 'README.md' }, { id: 'call_2' }), { stopReason: 'toolUse' }),
  (context: any) => {
    const readme = textOf(context.messages.findLast((m: any) => m.role === 'toolResult'));
    return fauxAssistantMessage('根据 README.md：' + readme.split('\n').find((l: string) => l.trim() && !l.startsWith('#')));
  },
]);

const requests: string[][] = [];
const executed: string[] = [];
const tools = [createLsTool(cwd), createReadTool(cwd)].map(tool => ({
  ...tool,
  execute: (id: string, args: any, signal?: AbortSignal, onUpdate?: any) => {
    executed.push(`${tool.name}(${JSON.stringify(args)})`);
    return tool.execute(id, args, signal, onUpdate);
  },
}));

const added = await runAgentLoop(
  [{ role: 'user', content: '这个项目是做什么的？', timestamp: 0 }],
  { messages: [], tools },
  { model: faux.getModel(), convertToLlm: m => m as any },
  () => {}, undefined,
  (model, context, options) => {
    requests.push(context.messages.map((m: any) => m.role));
    return faux.streamSimple(model, context, options);
  },
);

requests.forEach((roles, i) => console.log(`第 ${i + 1} 次请求：${roles.join(' → ')}`));
console.log(`\n真正执行的工具：${executed.join('，')}`);
console.log(`最终回答：${textOf(added.findLast(m => m.role === 'assistant'))}`);
