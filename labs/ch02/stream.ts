// 第 2 章实验：OpenAI 格式的流是怎样被拼成一条消息的。
//   node labs/ch02/stream.ts
// 分三步：① 字节怎样被切成网络包；② 每个 SSE 数据块带来什么、累计成什么（按 index 找到调用，id 和名字取第一次出现的，参数一律追加）；
// ③ Pi 的 openai-completions 适配器真正返回的消息，必须和第 ② 步算出来的一模一样。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getModel, streamSimpleOpenAICompletions } from '@earendil-works/pi-ai/compat';
import { startMock } from './mock-server.ts';

const file = new URL('./fixtures/openai-tool-call.sse', import.meta.url);
const bytes = readFileSync(file);
const CHUNK = 7;

// ① 切包：看看有没有一刀切在汉字中间
const slices: Buffer[] = [];
for (let i = 0; i < bytes.length; i += CHUNK) slices.push(bytes.subarray(i, i + CHUNK));
const splitAt = slices.findIndex((s, i) => i > 0 && (s[0] & 0b1100_0000) === 0b1000_0000);   // 下一包以“续字节”开头 = 汉字被切开了
const before = slices[splitAt - 1], after = slices[splitAt];
let head = before.length - 1;
while ((before[head] & 0b1100_0000) === 0b1000_0000) head--;                                  // 往回找到这个汉字的第一个字节
let tail = 0;
while ((after[tail] & 0b1100_0000) === 0b1000_0000) tail++;
const hex = (b: Uint8Array) => [...b].map(x => x.toString(16)).join(' ');
const letter = Buffer.concat([before.subarray(head), after.subarray(0, tail)]).toString('utf8');
console.log(`${bytes.length} 字节被切成 ${slices.length} 个网络包，每包最多 ${CHUNK} 字节。`);
console.log(`第 ${splitAt} 包末尾是“${letter}”的前 ${before.length - head} 个字节（${hex(before.subarray(head))}），后 ${tail} 个字节（${hex(after.subarray(0, tail))}）在第 ${splitAt + 1} 包开头：`);
console.log(`一个汉字被切成了两半。单独解码任何一半都得到乱码（${JSON.stringify(before.subarray(head).toString('utf8'))}）；`);
console.log('TextDecoder 的 stream: true 会把前半截留着，等后半截到了再一起解。\n');

// ② 数据块
const chunks = readFileSync(file, 'utf8').split('\n').filter(l => l.startsWith('data:') && !l.includes('[DONE]')).map(l => JSON.parse(l.slice(5)));
let text = '', id = '', name = '', args = '';
const rows: string[] = [];
chunks.forEach((chunk, i) => {
  const choice = chunk.choices[0];
  const delta = choice?.delta ?? {};
  const part = delta.tool_calls?.[0];
  let what = choice ? '' : `只带用量：${chunk.usage.prompt_tokens} 输入 / ${chunk.usage.completion_tokens} 输出`;
  if (delta.content) { text += delta.content; what = `文字 ${JSON.stringify(delta.content)}`; }
  if (part) {
    id ||= part.id ?? ''; name ||= part.function?.name ?? ''; args += part.function?.arguments ?? '';
    what = `工具调用 index=${part.index}${part.id ? `，id=${part.id}，名字=${part.function.name}` : ''}，参数片段 ${JSON.stringify(part.function?.arguments ?? '')}`;
  }
  if (choice?.finish_reason) what = `finish_reason = ${choice.finish_reason}`;
  if (choice && !what) what = '（开场，只有 role）';
  let parses = '—';
  if (args) { try { JSON.parse(args); parses = '能'; } catch { parses = '不能'; } }
  rows.push(`| ${i + 1} | ${what} | ${JSON.stringify(text)} | \`${args}\` | ${parses} |`);
});
console.log('| 块 | 这一块带来什么 | 文字累计 | 参数累计 | 参数能解析成 JSON？ |\n| --- | --- | --- | --- | --- |');
console.log(rows.join('\n'));

// ③ Pi 的适配器真正的解析结果
const mock = await startMock({ chunkBytes: CHUNK });
try {
  const model = { ...getModel('openai', 'gpt-4o-mini'), api: 'openai-completions' as const, baseUrl: mock.url };
  const context = { messages: [{ role: 'system', content: '', timestamp: 0 }, { role: 'user', content: '入口文件在哪里？', timestamp: 0 }] };
  const result: any = await streamSimpleOpenAICompletions(model as any, context as any, { apiKey: 'test' }).result();
  const pieces = result.content;
  assert.equal(pieces.find((b: any) => b.type === 'text').text, text);
  const call = pieces.find((b: any) => b.type === 'toolCall');
  assert.deepEqual([call.id, call.name, call.arguments], [id, name, JSON.parse(args)]);
  assert.equal(result.rawStopReason, 'tool_calls');
  console.log(`\nPi 的 openai-completions 适配器返回：文字 ${JSON.stringify(text)}，工具调用 ${call.name}(${JSON.stringify(call.arguments)}) id=${call.id}`);
  console.log(`原始 finish_reason=${result.rawStopReason} → stopReason=${result.stopReason}；用量块里的 ${result.usage.input} 输入 / ${result.usage.output} 输出 token 也被记了下来`);
  console.log('\n参数在最后一块之前一直是残缺的 JSON，所以适配器要等这一段参数收完，才会把它解析成对象交给循环。');
} finally {
  await mock.close();
}
