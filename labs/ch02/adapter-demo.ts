// 第 2 章练习的参考答案：给 mox 写一个 Anthropic 适配器（labs/ch02/adapter.ts）。
//   node labs/ch02/adapter-demo.ts
// 三项检查：① 读 Anthropic 样本，结果和 mox 的 openai() 读 OpenAI 样本一样；
//          ② 同一段对话翻译出来的请求体，和 Pi 的 Anthropic 适配器发出的结构一样；
//          ③ 流被截断时报错，而不是当作正常结束。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getModel, streamSimpleAnthropic } from '@earendil-works/pi-ai/compat';
import { runLoop } from '../../mox/src/loop.ts';
import { openai, type Msg } from '../../mox/src/model.ts';
import { anthropic } from './adapter.ts';
import { startMock } from './mock-server.ts';

const question: Msg[] = [{ role: 'user', content: '入口文件在哪里？' }];
const readFile = { name: 'read_file', description: '读取文件', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } };

// ① 同样的内容，两种线上格式，得到同样的 mox 消息（id 是各家自己生成的，不比较）
const mock = await startMock();
const fromOpenAI = await openai({ baseUrl: mock.url, apiKey: 'test', model: 'x' })({ messages: question, tools: [readFile] });
const fromAnthropic = await anthropic({ baseUrl: mock.url, apiKey: 'test', model: 'x' })({ messages: question, tools: [readFile] });
const strip = (r: typeof fromOpenAI) => ({ ...r, message: { ...r.message, tool_calls: r.message.tool_calls?.map(c => ({ ...c, id: '·' })) } });
assert.deepEqual(strip(fromAnthropic), strip(fromOpenAI));
console.log('① 读 Anthropic 样本得到的 mox 消息（和 openai() 读 OpenAI 样本的结果相同）：');
console.log(JSON.stringify(fromAnthropic));

// ② 请求体：同一段含两个并行工具调用的对话，拿 Pi 发出的请求对照结构
const history: Msg[] = [
  { role: 'user', content: '比较 README 和入口文件' },
  { role: 'assistant', content: '我同时读两个文件。', tool_calls: [
    { id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"README.md"}' } },
    { id: 'call_2', type: 'function', function: { name: 'read_file', arguments: '{"path":"src/cli.ts"}' } },
  ] },
  { role: 'tool', tool_call_id: 'call_1', content: '# Mox Notes …' },
  { role: 'tool', tool_call_id: 'call_2', content: '错误：ENOENT: src/cli.ts' },
];
mock.requests.length = 0;
await anthropic({ baseUrl: mock.url, apiKey: 'test', model: 'x' })({ messages: [{ role: 'system', content: '你是代码助手。' }, ...history] });
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const piContext = { messages: [
  { role: 'system', content: '你是代码助手。', timestamp: 0 },
  { role: 'user', content: '比较 README 和入口文件', timestamp: 0 },
  { role: 'assistant', api: 'anthropic-messages', provider: 'anthropic', model: 'x', usage, stopReason: 'toolUse', timestamp: 1, content: [
    { type: 'text', text: '我同时读两个文件。' },
    { type: 'toolCall', id: 'call_1', name: 'read_file', arguments: { path: 'README.md' } },
    { type: 'toolCall', id: 'call_2', name: 'read_file', arguments: { path: 'src/cli.ts' } },
  ] },
  { role: 'toolResult', toolCallId: 'call_1', toolName: 'read_file', content: [{ type: 'text', text: '# Mox Notes …' }], isError: false, timestamp: 2 },
  { role: 'toolResult', toolCallId: 'call_2', toolName: 'read_file', content: [{ type: 'text', text: 'ENOENT: src/cli.ts' }], isError: true, timestamp: 3 },
] };
await streamSimpleAnthropic({ ...getModel('anthropic', 'claude-sonnet-4-5'), baseUrl: mock.url } as any, piContext as any, { apiKey: 'test' }).result();
const [mine, pis] = mock.requests.map(r => r.body);
const shape = (messages: any[]) => messages.map(m => `${m.role}[${Array.isArray(m.content) ? m.content.map((b: any) => b.type + (b.is_error ? '(错误)' : '')).join(',') : 'text'}]`);
assert.deepEqual(shape(mine.messages), shape(pis.messages));
console.log('\n② 请求体里 messages 的结构（左：本适配器；右：Pi）：');
console.log('   ', shape(mine.messages).join('  '));
console.log('   ', shape(pis.messages).join('  '));

// ③ 截断：Anthropic 的流在 message_delta 之前就断开 → 适配器抛错
await mock.close();
const full = readFileSync(new URL('./fixtures/anthropic-tool-call.sse', import.meta.url), 'utf8');
const cut = await startMock({ cutAfterBytes: Buffer.byteLength(full.slice(0, full.indexOf('th\\": \\"src/'))) });
const error = await anthropic({ baseUrl: cut.url, apiKey: 'test', model: 'x' })({ messages: question }).then(() => '没有报错', e => (e as Error).message);
console.log(`\n③ 参数生成到一半断开：${error}`);
assert.match(error, /stop_reason/);

// 循环一行不用改：适配器返回的就是 mox 的 Model。第一个工具结果出来后取消，免得假服务反复回同一段流
await cut.close();
const loopMock = await startMock();
const controller = new AbortController();
const tool = { ...readFile, run: ({ path }: { path: string }) => `（读到了 ${path}）` };
const results: string[] = [];
await runLoop([...question], { model: anthropic({ baseUrl: loopMock.url, apiKey: 'test', model: 'x' }), system: '', tools: [tool], signal: controller.signal,
  onEvent: e => { if (e.type === 'tool_end') { results.push(e.result); controller.abort(); } } }).catch(() => {});
await loopMock.close();
console.log(`\n放进 runLoop：模型请求了 read_file，循环执行后得到 ${JSON.stringify(results[0])}`);
assert.equal(results[0], '（读到了 src/cli.ts）');
