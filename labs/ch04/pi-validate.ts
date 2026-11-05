// 第 4 章实验：Pi 怎样对待写错的参数？
//   node labs/ch04/pi-validate.ts
// 模型第一次把参数名写错（file 而不是 path），还把 limit 写成了字符串 "20"。
// "20" 会被自动修正成数字 20（宽进）；参数名写错修不了，校验失败（严出），错误信息作为工具结果交回，模型第二次就改对了。
import assert from 'node:assert/strict';
import { runPi, type RunTool } from '../shared/harness.ts';
import type { Script } from '../shared/scripted.ts';

const received: unknown[] = [];
const readFile: RunTool = {
  name: 'read_file',
  description: '读取文件的前若干行',
  parameters: { type: 'object', properties: { path: { type: 'string' }, limit: { type: 'integer', minimum: 1 } }, required: ['path'], additionalProperties: false },
  run: args => { received.push(args); return `${args.path} 的前 ${args.limit ?? '全部'} 行：# Mox Notes …`; },
};
const script: Script = (_messages, n) =>
  n === 1 ? { toolCalls: [{ name: 'read_file', arguments: { file: 'README.md', limit: '20' } }] }
  : n === 2 ? { toolCalls: [{ name: 'read_file', arguments: { path: 'README.md', limit: '20' } }] }
  : { text: '读到了：这是 Mox Notes 的说明。' };

const report = await runPi({ prompt: '看看 README 的前 20 行', script, tools: [readFile] });
const [first, second] = report.results;
console.log(`${report.requests} 次请求\n`);
console.log(`第一次调用 { file: "README.md", limit: "20" }，isError=${first.isError}，模型看到：\n${first.content}\n`);
console.log(`第二次调用 { path: "README.md", limit: "20" }，isError=${second.isError}，模型看到：${second.content}`);
console.log(`工具函数真正收到的参数：${JSON.stringify(received)}（limit 的类型是 ${typeof (received[0] as any).limit}）`);

assert.equal(report.requests, 3);
assert.ok(first.isError && /path/.test(first.content) && first.content.includes('"file"'));   // 逐条列出问题，并附上收到的原始参数
assert.equal(received.length, 1);                                                               // 校验失败的那次，工具函数没有被调用
assert.deepEqual(received[0], { path: 'README.md', limit: 20 });                                // "20" 被修正成了数字
