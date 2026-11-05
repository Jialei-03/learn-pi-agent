// 第 2 章实战的检验：mox 的 model.ts —— 流式 SSE、拼工具调用分片、finish_reason、断流报错。
//   node labs/ch02/practice.ts                      检验参考实现 mox/
//   MOX_DIR=~/my-mox node labs/ch02/practice.ts     检验你自己写的
// 需要 src/model.ts 导出 openai({ baseUrl, apiKey, model })，返回 (request) => Promise<{ message, finish }>。
// 请求发给本地假服务（把样本每 7 字节切一刀）；另外拿 Pi 的适配器读同一段真实录制，对照结果。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getModel, streamSimpleOpenAICompletions } from '@earendil-works/pi-ai/compat';
import { loadMox, whose } from '../shared/mox-dir.ts';
import { startMock } from './mock-server.ts';

console.log(`${whose()}\n`);
const { openai } = await loadMox('model.ts');
const ask = (baseUrl: string, extra: object = {}) =>
  openai({ baseUrl, apiKey: 'test', model: 'x' })({ messages: [{ role: 'system', content: '你是代码助手。' }, { role: 'user', content: '入口文件在哪里？' }], tools: [{ name: 'read_file', description: '读取文件', parameters: { type: 'object', properties: {} } }], ...extra });
const results: [string, string][] = [];
const check = (what: string, how: string) => results.push([what, how]);

// ① 测试样本：参数分三片到达，汉字被切成两半
let mock = await startMock({ chunkBytes: 7 });
const streamed: string[] = [];
const reply = await ask(mock.url, { onText: (t: string) => streamed.push(t) });
assert.equal(reply.message.role, 'assistant');
assert.equal(reply.message.content, '我先看看入口文件。', '文字要拼完整（被切开的汉字不能乱码）');
assert.deepEqual(reply.message.tool_calls, [{ id: 'call_01', type: 'function', function: { name: 'read_file', arguments: '{"path": "src/cli.ts"}' } }], '三片参数要按 index 拼成一个完整的调用');
assert.equal(reply.finish, 'tool_calls');
assert.equal(streamed.join(''), reply.message.content, '文字要通过 onText 一段段送出去');
assert.ok(streamed.length >= 2);
check('文字、工具调用、finish', `content=${JSON.stringify(reply.message.content)}，finish=${reply.finish}，onText ${streamed.length} 次`);

// ② 请求体：messages 原样发出，stream: true，tools 每项包一层 function
const body = mock.requests[0].body;
assert.equal(body.stream, true);
assert.deepEqual(body.messages, [{ role: 'system', content: '你是代码助手。' }, { role: 'user', content: '入口文件在哪里？' }], 'messages 要原样发出，没有翻译');
assert.equal(body.tools[0].type, 'function');
assert.equal(body.tools[0].function.name, 'read_file');
check('请求体', 'messages 与传入的数组逐字相同，stream=true，tools 包了一层 function');
await mock.close();

// ③ 真实录制：同一段字节，mox 和 Pi 读出同样的内容和 id
mock = await startMock({ files: { openai: 'recorded/minimax-m31-flash-stream.sse' } });
const real = await ask(mock.url);
const model = { ...getModel('openai', 'gpt-4o-mini'), api: 'openai-completions' as const, baseUrl: mock.url };
const pi: any = await streamSimpleOpenAICompletions(model as any, { messages: [{ role: 'system', content: '', timestamp: 0 }, { role: 'user', content: 'x', timestamp: 0 }] } as any, { apiKey: 'test' }).result();
await mock.close();
assert.equal(real.message.tool_calls.length, 2);
assert.equal(real.message.content, pi.content.find((b: any) => b.type === 'text').text);
assert.deepEqual(real.message.tool_calls.map((c: any) => [c.id, c.function.name, JSON.parse(c.function.arguments)]), pi.content.filter((b: any) => b.type === 'toolCall').map((b: any) => [b.id, b.name, b.arguments]));
check('真实录制（MiniMax）', `两个工具调用的 id、名字、参数与 Pi 读出的完全一致；思考内容 ${pi.content.find((b: any) => b.type === 'thinking').thinking.length} 字符 mox 不保存`);

// ④ 断流：流在 finish_reason 之前结束 → 必须报错，不能当成正常结束
const full = readFileSync(new URL('./fixtures/openai-tool-call.sse', import.meta.url), 'utf8');
const at = (marker: string) => Buffer.byteLength(full.slice(0, full.lastIndexOf('\n\n', full.indexOf(marker)) + 2));
for (const [where, cutAfterBytes] of [['文字说到一半', at('入口文件。')], ['参数残缺', at('th\\": \\"src/')], ['参数完整、缺 finish_reason', at('"finish_reason": "tool_calls"')]] as const) {
  mock = await startMock({ cutAfterBytes });
  const outcome = await ask(mock.url).then(() => '没有报错', (e: Error) => e.message);
  await mock.close();
  assert.notEqual(outcome, '没有报错', `${where}：流被截断，必须抛错（初始 finish 不能是 'stop'）`);
  check(`断流：${where}`, `抛错：${outcome}`);
}

// ⑤ HTTP 错误：状态码在错误信息里
mock = await startMock({ status: 429 });
const http = await ask(mock.url).then(() => '没有报错', (e: Error) => e.message);
await mock.close();
assert.match(http, /429/);
check('HTTP 429', `抛错：${http.slice(0, 40)}…`);

// ⑥ 取消：signal 传给 fetch，取消时抛出（不是返回半截消息）
mock = await startMock({ chunkBytes: 7 });
const controller = new AbortController();
const cancelled = await ask(mock.url, { signal: controller.signal, onText: () => controller.abort() }).then(() => '没有报错', (e: Error) => e.name);
await mock.close();
assert.equal(cancelled, 'AbortError');
check('取消', '抛出 AbortError');

console.log('| 检查 | 结果 |\n| --- | --- |');
for (const [what, how] of results) console.log(`| ${what} | ${how} |`);
console.log('\n全部通过');
