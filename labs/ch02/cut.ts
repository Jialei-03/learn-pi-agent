// 第 2 章实验：连接在回复中途结束（服务端提前收尾，或者中间的代理把流截断了），Pi 的适配器会怎样？
//   node labs/ch02/cut.ts
// 同一个“读 src/cli.ts”的回复，OpenAI 和 Anthropic 两种格式各在三个位置截断。
// 要看的问题：流没有给出停止原因就结束了，调用方会不会发现？
import { readFileSync } from 'node:fs';
import { getModel, streamSimpleAnthropic, streamSimpleOpenAICompletions } from '@earendil-works/pi-ai/compat';
import { startMock } from './mock-server.ts';

const read = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const files = { openai: read('openai-tool-call.sse'), anthropic: read('anthropic-tool-call.sse') };
/** 某段文字所在的数据块开头的字节位置 */
const offset = (text: string, marker: string) => Buffer.byteLength(text.slice(0, text.lastIndexOf('\n\n', text.indexOf(marker)) + 2));
const cuts = {
  openai: [offset(files.openai, '入口文件。'), offset(files.openai, 'th\\": \\"src/'), offset(files.openai, '"finish_reason": "tool_calls"')],
  anthropic: [offset(files.anthropic, '入口文件。'), offset(files.anthropic, 'th\\": \\"src/'), offset(files.anthropic, 'event: message_delta')],
};
const where = ['文字说到一半', '参数 {"pa 之后', '参数已经完整，停止原因之前'];

async function piResult(api: 'openai' | 'anthropic', cutAfterBytes: number) {
  const mock = await startMock({ cutAfterBytes });
  try {
    const context = { messages: [{ role: 'system', content: '', timestamp: 0 }, { role: 'user', content: '入口文件在哪里？', timestamp: 0 }] };
    const result: any = api === 'openai'
      ? await streamSimpleOpenAICompletions({ ...getModel('openai', 'gpt-4o-mini'), api: 'openai-completions', baseUrl: mock.url } as any, context as any, { apiKey: 'test' }).result()
      : await streamSimpleAnthropic({ ...getModel('anthropic', 'claude-sonnet-4-5'), baseUrl: mock.url } as any, context as any, { apiKey: 'test' }).result();
    const kept = result.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    const calls = result.content.filter((b: any) => b.type === 'toolCall').map((b: any) => `${b.name}(${JSON.stringify(b.arguments)})`);
    return `stopReason=\`${result.stopReason}\`<br>${result.errorMessage}<br>保留：${JSON.stringify(kept)}${calls.length ? `，${calls.join('')}` : ''}`;
  } finally { await mock.close(); }
}

console.log('| 在哪里断开 | OpenAI 格式的流 | Anthropic 格式的流 |\n| --- | --- | --- |');
for (let i = 0; i < where.length; i++) {
  console.log(`| ${where[i]} | ${await piResult('openai', cuts.openai[i])} | ${await piResult('anthropic', cuts.anthropic[i])} |`);
}
const full = await piResult('openai', Buffer.byteLength(files.openai));
console.log(`\n对照：没有断开的完整流 → ${full.split('<br>')[0]}`);
