// 第 1 章实战的最后一步：把你写的循环接上真实模型（模型调用直接用参考实现的 openai()）。
//   export MOX_BASE_URL=https://api.minimaxi.com/v1 MOX_API_KEY=… MOX_MODEL=MiniMax-M3.1-Flash
//   node labs/ch01/chat.ts "这个项目是做什么的？"
//   MOX_DIR=~/my-mox node labs/ch01/chat.ts "入口文件在哪里？"
// 构建网站时不会运行它（需要 API Key，会产生真实用量）。
import { openai } from '../../mox/src/model.ts';
import { loadMox, whose } from '../shared/mox-dir.ts';

const { MOX_BASE_URL, MOX_API_KEY, MOX_MODEL } = process.env;
if (!MOX_MODEL || !MOX_API_KEY) throw new Error('先设置 MOX_BASE_URL、MOX_API_KEY、MOX_MODEL');
console.error(whose());
const { runLoop } = await loadMox('loop.ts');
const { codingTools } = await loadMox('tools.ts');

const model = openai({ baseUrl: MOX_BASE_URL, apiKey: MOX_API_KEY, model: MOX_MODEL });
const messages = [{ role: 'user', content: process.argv[2] ?? '这个项目是做什么的？' }];
const answer = await runLoop(messages, {
  model, system: `你是一个编程助手，可以用工具查看工作目录里的文件。工作目录是 ${process.cwd()}。`,
  tools: codingTools(process.cwd()),
  onEvent: (e: any) => { if (e.type === 'text') process.stdout.write(e.text); if (e.type === 'tool_start') console.error(`\n● ${e.call.function.name} ${e.call.function.arguments}`); },
});
console.log(`\n\n（共 ${messages.length} 条消息）`);
