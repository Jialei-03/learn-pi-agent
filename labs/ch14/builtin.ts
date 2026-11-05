// 第 14 章实验：mox 自带的权限。启动真正的命令行（mox/src/cli.ts），连到一个假的模型服务，看三种运行方式下每个工具调用的下场。
//   node labs/ch14/builtin.ts
// 模型是脚本：先读文件，再写两个文件，最后跑一条命令。命令行是真的，工具是真的，只有模型是假的。
import assert from 'node:assert/strict';
import { callsInOrder, runCli } from './cli-run.ts';

const script = callsInOrder([
  { name: 'read', arguments: { path: 'notes.txt' } },
  { name: 'write', arguments: { path: 'a.txt', content: 'a\n' } },
  { name: 'write', arguments: { path: 'b.txt', content: 'b\n' } },
  { name: 'bash', arguments: { command: 'ls' } },
]);

async function run(title: string, flags: string[], answers?: string[]) {
  const r = await runCli({ script, prompt: '按 notes.txt 干活', flags, answers, project: { 'notes.txt': '待办：写两个文件\n' } });
  console.log(`━━ ${title} ━━`);
  for (const o of r.outcomes) console.log(`${o.ok ? '✓' : '✗'} ${o.what.padEnd(14)} ${o.result.replace(/\s+/g, ' ').slice(0, 64)}`);
  console.log(`磁盘上：a.txt ${r.exists('a.txt') ? '有' : '没有'}，b.txt ${r.exists('b.txt') ? '有' : '没有'}\n`);
  return { ok: r.outcomes.map(o => o.ok), results: r.outcomes.map(o => o.result), files: [r.exists('a.txt'), r.exists('b.txt')] };
}

// 1. -p：没有终端，没法确认，只读的 read 放行，其余全部拒绝
const quiet = await run('mox -p（没有终端）', []);
assert.deepEqual(quiet.ok, [true, false, false, false]);
assert.ok(quiet.results[1].includes('没有终端可以确认') && quiet.results[1].includes('--yolo'));
assert.deepEqual(quiet.files, [false, false]);

// 2. --yolo：不再询问
const yolo = await run('mox -p --yolo', ['--yolo']);
assert.deepEqual(yolo.ok, [true, true, true, true]);
assert.deepEqual(yolo.files, [true, true]);

// 3. 交互：第一次 write 选“本次会话都允许”，之后的 write 不再问；bash 是另一个工具，要重新问，选“拒绝”
const talk = await run('mox（有终端）：2 = 本次会话都允许，3 = 拒绝', [], ['2', '3']);
assert.deepEqual(talk.ok, [true, true, true, false]);
assert.equal(talk.results[3], '错误：用户拒绝了这次调用');
assert.deepEqual(talk.files, [true, true]);
console.log('只问了两次：第一个 write（选了“本次会话都允许”）和 bash。第二个 write 直接放行，因为“本次会话都允许”记的是工具名。');
