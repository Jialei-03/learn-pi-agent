// 第 1 章：用真实模型把“第一个 Agent”跑一遍，存成 recorded/first-run.json（需要 API Key，构建时不会运行）。
//   export MOX_BASE_URL=https://api.minimaxi.com/v1 MOX_API_KEY=… MOX_MODEL=MiniMax-M3.1-Flash
//   node labs/ch01/record.ts
// 做的事和 labs/ch01/first-agent.ts 完全一样，只是模型换成 mox 的 openai()。
// 录下来的是每次请求发出的消息条数、模型的每条回复和每个工具的结果；Key 不会写进文件。
import { cpSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLoop } from '../../mox/src/loop.ts';
import { openai, type Model, type Msg } from '../../mox/src/model.ts';
import { codingTools } from '../../mox/src/tools.ts';

const { MOX_BASE_URL, MOX_API_KEY, MOX_MODEL } = process.env;
if (!MOX_MODEL || !MOX_API_KEY) throw new Error('先设置 MOX_BASE_URL、MOX_API_KEY、MOX_MODEL');

// 在临时目录的副本里跑：模型看不到课程仓库，路径里也不会出现你的用户名
const cwd = join(realpathSync(mkdtempSync(join(tmpdir(), 'mox-ch01-'))), 'project');
cpSync(fileURLToPath(new URL('../fixtures/mox-project/', import.meta.url)), cwd, { recursive: true });
const prompt = '这个项目是做什么的？';
const system = `你是一个编程助手，可以用工具查看和修改工作目录里的文件。工作目录是 ${cwd}。回答要简短。`;
const real = openai({ baseUrl: MOX_BASE_URL, apiKey: MOX_API_KEY, model: MOX_MODEL });

const requests: { messages: number; finish: string }[] = [];
const model: Model = async request => {
  const reply = await real(request);
  requests.push({ messages: request.messages.length, finish: reply.finish });
  return reply;
};

const messages: Msg[] = [{ role: 'user', content: prompt }];
const answer = await runLoop(messages, { model, system, tools: codingTools(cwd) });
const record = JSON.stringify({
  kind: 'real-run', model: MOX_MODEL, endpoint: new URL(MOX_BASE_URL ?? 'https://api.openai.com/v1').origin,
  captured_at: new Date().toISOString().slice(0, 10), system, prompt, requests, messages, answer,
}, null, 2);
writeFileSync(new URL('./recorded/first-run.json', import.meta.url), record.replaceAll(cwd, '/work/project').replaceAll(userInfo().username, 'user'));
rmSync(join(cwd, '..'), { recursive: true });
console.log(`录下了 ${requests.length} 次请求，${messages.length} 条消息`);
