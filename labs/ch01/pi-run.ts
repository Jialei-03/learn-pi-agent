// 第 1 章实验的共用部分：用 Pi 真实的 runAgentLoop + 自带的 ls / read 工具跑“这个项目是做什么的？”。
// 模型换成 Pi 的 faux（脚本）模型：先 ls，再读 README，最后用 README 里的一句话回答。
// 循环、工具、消息格式全是 Pi 的真实代码，只有“模型”是假的。
import { fileURLToPath } from 'node:url';
import { runAgentLoop } from '@earendil-works/pi-agent-core';
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { createLsTool, createReadTool } from '@earendil-works/pi-coding-agent';

export const cwd = fileURLToPath(new URL('../fixtures/mox-project/', import.meta.url));
export const PROMPT = '这个项目是做什么的？';
export const textOf = (m: any) => (typeof m.content === 'string' ? m.content : m.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(''));

export async function runPi() {
  const faux = createFauxCore({});
  faux.setResponses([
    () => fauxAssistantMessage([fauxToolCall('ls', { path: '.' }, { id: 'call_1' })], { stopReason: 'toolUse' }),
    () => fauxAssistantMessage([fauxToolCall('read', { path: 'README.md' }, { id: 'call_2' })], { stopReason: 'toolUse' }),
    (context: any) => {
      const readme = textOf(context.messages.findLast((m: any) => m.role === 'toolResult'));
      return fauxAssistantMessage('根据 README.md：' + readme.split('\n').find((l: string) => l.trim() && !l.startsWith('#')));
    },
  ]);

  const requests: any[][] = [];                 // 每次请求发出时，上下文里的消息（拷贝）
  const executed: string[] = [];
  const tools = [createLsTool(cwd), createReadTool(cwd)].map(tool => ({
    ...tool,
    execute: (id: string, args: any, signal?: AbortSignal, onUpdate?: any) => {
      executed.push(`${tool.name}(${JSON.stringify(args)})`);
      return tool.execute(id, args, signal, onUpdate);
    },
  }));

  const added = await runAgentLoop(
    [{ role: 'user', content: PROMPT, timestamp: 0 }],
    { messages: [], tools },
    { model: faux.getModel(), convertToLlm: m => m as any },
    () => {}, undefined,
    (model, context, options) => {
      requests.push(structuredClone(context.messages));
      return faux.streamSimple(model, context, options);
    },
  );
  return { requests, executed, added, tools };
}
