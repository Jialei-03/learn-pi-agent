// 第 1 章实验的共用部分：用 mox 的 runLoop + codingTools 跑“第一个 Agent”，模型换成脚本。
// 脚本模型的决策：先 ls，再读 README，最后用 README 里的一句话回答。
// 循环、工具、消息格式全是 mox 的真实代码；只有“模型”是假的。
import { fileURLToPath } from 'node:url';
import { runLoop } from '../../mox/src/loop.ts';
import type { Msg } from '../../mox/src/model.ts';
import { codingTools } from '../../mox/src/tools.ts';
import { scripted } from '../shared/scripted.ts';

export const cwd = fileURLToPath(new URL('../fixtures/mox-project/', import.meta.url));
export const PROMPT = '这个项目是做什么的？';
export const SYSTEM = '你是一个编程助手，可以用工具查看和修改工作目录里的文件。';

export async function runFirstAgent() {
  const model = scripted((messages: Msg[], n: number) => {
    if (n === 1) return { toolCalls: [{ name: 'ls', arguments: { path: '.' } }] };
    if (n === 2) return { toolCalls: [{ name: 'read', arguments: { path: 'README.md' } }] };
    const readme = messages.findLast(m => m.role === 'tool')!.content;
    const summary = readme.split('\n').find(line => line.trim() && !line.startsWith('#'));
    return { text: `根据 README.md：${summary}` };
  });
  const tools = codingTools(cwd);
  const executed: string[] = [];
  const messages: Msg[] = [{ role: 'user', content: PROMPT }];
  const answer = await runLoop(messages, {
    model, system: SYSTEM, tools,
    onEvent: e => { if (e.type === 'tool_start') executed.push(`${e.call.function.name} ${e.call.function.arguments}`); },
  });
  return { requests: model.requests, messages, executed, answer, tools };
}
