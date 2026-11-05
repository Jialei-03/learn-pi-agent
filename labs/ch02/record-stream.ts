// 第 2 章：把真实模型的一次流式回复原样存下来（需要 API Key，构建时不会运行）。
//   export MOX_BASE_URL=https://api.minimaxi.com/v1 MOX_API_KEY=… MOX_MODEL=MiniMax-M3.1-Flash
//   node labs/ch02/record-stream.ts
// 做法：用 mox 的 openai() 发一次请求，只在 fetch 外面包一层，把响应体的字节原样抄一份。
// 抄下来的只有响应体（SSE），不含请求头，所以 Key 不会出现在文件里。
import { writeFileSync } from 'node:fs';
import { openai } from '../../mox/src/model.ts';

const { MOX_BASE_URL, MOX_API_KEY, MOX_MODEL } = process.env;
if (!MOX_MODEL || !MOX_API_KEY) throw new Error('先设置 MOX_BASE_URL、MOX_API_KEY、MOX_MODEL');

const raw: Buffer[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const res = await realFetch(input, init);
  const [mine, theirs] = res.body!.tee();
  (async () => { for await (const chunk of mine) raw.push(Buffer.from(chunk)); })();
  return new Response(theirs, { status: res.status, headers: res.headers });
};

const model = openai({ baseUrl: MOX_BASE_URL, apiKey: MOX_API_KEY, model: MOX_MODEL });
const readTool = {
  name: 'read_file', description: '读取文件', parameters: { type: 'object', properties: { path: { type: 'string', description: '文件路径' } }, required: ['path'] },
};
const reply = await model({
  messages: [
    { role: 'system', content: '你是代码助手。需要看文件时调用工具。' },
    { role: 'user', content: '入口文件在哪里？先用一句话说明你要做什么，再读取 src/cli.ts。' },
  ],
  tools: [readTool],
});
await new Promise(r => setTimeout(r, 200));
writeFileSync(new URL('./recorded/minimax-m31-flash-stream.sse', import.meta.url), Buffer.concat(raw));
console.log(`存下了 ${Buffer.concat(raw).length} 字节；mox 解析结果：`, JSON.stringify(reply));
