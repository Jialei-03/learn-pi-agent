// 第 1 章实战的检验：mox 的最小循环 + read 工具。
//   node labs/ch01/practice.ts                      检验参考实现 mox/
//   MOX_DIR=~/my-mox node labs/ch01/practice.ts     检验你自己写的
// 需要 src/loop.ts 导出 runLoop(messages, { model, system, tools })，src/tools.ts 导出 codingTools(cwd)（至少有 read）。
// 模型是脚本，所以离线、确定；循环和工具是你写的。
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadMox, whose } from '../shared/mox-dir.ts';
import { scripted } from '../shared/scripted.ts';

console.log(`${whose()}\n`);
const { runLoop } = await loadMox('loop.ts');
const { codingTools } = await loadMox('tools.ts');
const cwd = fileURLToPath(new URL('../fixtures/mox-project/', import.meta.url));
const SYSTEM = '你是一个编程助手。';

const tools = codingTools(cwd).filter((t: any) => t.name === 'read');
assert.equal(tools.length, 1, 'codingTools 里要有一个叫 read 的工具');

// ① 读 README，再回答
const model = scripted((messages, n) => n === 1
  ? { toolCalls: [{ id: 'call_a', name: 'read', arguments: { path: 'README.md' } }] }
  : { text: '根据 README：' + String(messages.findLast(m => m.role === 'tool')!.content).split('\n').find(l => l.trim() && !l.startsWith('#')) });
const messages: any[] = [{ role: 'user', content: '这个项目是做什么的？' }];
const answer = await runLoop(messages, { model, system: SYSTEM, tools });

console.log('| 请求 | 发给模型的消息（按顺序） |\n| --- | --- |');
model.requests.forEach((r, i) => console.log(`| 第 ${i + 1} 次 | ${r.messages.map((m: any) => m.role).join(' → ')} |`));
console.log(`\n最终回答：${answer}`);

assert.equal(model.requests.length, 2, '读一次文件、回答一次：共 2 次请求');
assert.deepEqual(model.requests[0].messages.map((m: any) => m.role), ['system', 'user']);
assert.equal(model.requests[0].messages[0].content, SYSTEM, '每次请求最前面要加 system');
assert.deepEqual(model.requests[1].messages.map((m: any) => m.role), ['system', 'user', 'assistant', 'tool'], '第二次请求要带上模型自己的回复和工具结果');
assert.equal(model.requests[1].messages[3].tool_call_id, 'call_a', '工具结果要用 tool_call_id 对应到请求');
assert.match(model.requests[1].messages[3].content, /Mox Notes/, 'read 要真的读出文件内容');
assert.ok(model.requests[0].tools.every((t: any) => t.run === undefined && t.name && t.parameters), '发给模型的是说明书（name / description / parameters），不能带上 run');
assert.deepEqual(messages.map((m: any) => m.role), ['user', 'assistant', 'tool', 'assistant'], 'messages 要就地追加');
assert.match(answer, /命令行笔记工具/);

// ② 一条回复里有两个调用：按顺序执行，每个都有结果
const order: string[] = [];
const spy = tools.map((t: any) => ({ ...t, run: (args: any, signal: any) => { order.push(args.path); return t.run(args, signal); } }));
const two = scripted((_m, n) => n === 1
  ? { toolCalls: [{ id: 'c1', name: 'read', arguments: { path: 'README.md' } }, { id: 'c2', name: 'read', arguments: { path: 'src/cli.ts' } }] }
  : { text: '读完了' });
const history2: any[] = [{ role: 'user', content: '读两个文件' }];
await runLoop(history2, { model: two, system: SYSTEM, tools: spy });
assert.deepEqual(order, ['README.md', 'src/cli.ts']);
assert.deepEqual(history2.filter(m => m.role === 'tool').map(m => m.tool_call_id), ['c1', 'c2']);
console.log('一条回复里的两个调用：按顺序执行，各有一条结果');
console.log('\n全部通过');
