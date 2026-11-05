// 第 2 章实验：连接在回复中途结束（服务端提前收尾，或者中间的代理把流截断了），会发生什么？
//   node labs/ch02/cut.ts
// 同一段 OpenAI 格式的流，在三个位置截断，分别交给 mox 的 openai() + runLoop 和 Pi 的适配器。
// 要看的问题：流没有给出 finish_reason 就结束了，下游会不会发现？（mox 的 openai() 在这里抛错；最后一行是没断开的对照）
import { readFileSync } from 'node:fs';
import { getModel, streamSimpleOpenAICompletions } from '@earendil-works/pi-ai/compat';
import { runLoop } from '../../mox/src/loop.ts';
import { openai } from '../../mox/src/model.ts';
import { startMock } from './mock-server.ts';

const full = readFileSync(new URL('./fixtures/openai-tool-call.sse', import.meta.url), 'utf8');
const offset = (marker: string) => Buffer.byteLength(full.slice(0, full.lastIndexOf('\n\n', full.indexOf(marker)) + 2));   // 某个数据块开头的字节位置
const cuts = [
  { where: '文字说到一半', at: offset('入口文件。') },
  { where: '参数 {"pa 之后', at: offset('th\\": \\"src/') },
  { where: '参数完整，finish_reason 之前', at: offset('"finish_reason": "tool_calls"') },
];
const question = [{ role: 'user' as const, content: '入口文件在哪里？' }];
const readFile = {
  name: 'read_file', description: '读取文件', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  run: ({ path }: { path: string }) => `（读到了 ${path}）`,
};

/** 把截断的流交给 mox 的 openai()，再交给 runLoop。 */
async function viaMox(cutAfterBytes: number) {
  const mock = await startMock({ cutAfterBytes });
  try {
    const model = openai({ baseUrl: mock.url, apiKey: 'test', model: 'x' });
    const reply = await model({ messages: question, tools: [readFile] }).then(r => r, (e: Error) => e);
    const messages = [...question];
    let toolRan = false;
    const controller = new AbortController();     // 工具一执行就取消：假服务每次都回同一段流，不取消会一直转
    const run = (args: { path: string }) => { toolRan = true; controller.abort(); return readFile.run(args); };
    const loop = await runLoop(messages, { model, system: '', tools: [{ ...readFile, run }], signal: controller.signal }).then(() => 'ok', (e: Error) => e);
    return { reply, loop, history: messages.length, toolRan };
  } finally { await mock.close(); }
}

async function viaPi(cutAfterBytes: number) {
  const mock = await startMock({ cutAfterBytes });
  try {
    const context = { messages: [{ role: 'system', content: '', toolsAdded: [readFile], timestamp: 0 }, { role: 'user', content: question[0].content, timestamp: 0 }] };
    const model = { ...getModel('openai', 'gpt-4o-mini'), api: 'openai-completions' as const, baseUrl: mock.url };
    const result: any = await streamSimpleOpenAICompletions(model as any, context as any, { apiKey: 'test' }).result();
    return { stopReason: result.stopReason as string, error: result.errorMessage as string | undefined, kept: result.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('') };
  } finally { await mock.close(); }
}

console.log(`完整的流有 ${Buffer.byteLength(full)} 字节。\n`);
console.log('| 在哪里断开 | mox：openai() | mox：runLoop | Pi：适配器返回 |\n| --- | --- | --- | --- |');
for (const cut of [...cuts, { where: '没有断开（对照）', at: Buffer.byteLength(full) }]) {
  const m = await viaMox(cut.at);
  const p = await viaPi(cut.at);
  const returned = m.reply instanceof Error
    ? `抛出异常：${m.reply.message}`
    : `返回 finish=\`${m.reply.finish}\`，文字 ${JSON.stringify(m.reply.message.content)}，参数 \`${m.reply.message.tool_calls?.[0].function.arguments}\``;
  const loop = m.toolRan ? '工具执行了（随即取消，免得假服务重复回同一段流）' : `异常冒出 runLoop，工具没有执行，历史还是 ${m.history} 条`;
  console.log(`| ${cut.where}（${cut.at} 字节） | ${returned} | ${loop} | stopReason=\`${p.stopReason}\`，${p.error ? `错误：${p.error.slice(0, 60)}` : '没有错误信息'}；保留文字 ${JSON.stringify(p.kept)} |`);
}
