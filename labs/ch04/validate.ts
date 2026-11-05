// 第 4 章实验：参数写错了，mox 会怎样？
//   node labs/ch04/validate.ts
// mox 的 execute 对参数只做一件事：JSON.parse。格式对不对，由工具函数自己去撞。
// 这里用 mox 真实的 read 工具，分别交给：mox 原样、mox + 参考实现 withValidation、Pi（自带校验）。
//   情形 A：参数名写错（file 而不是 path），第二次请求才改对
//   情形 B：数字写成字符串（offset: "3", limit: "2"），看模型拿到什么
// 注意 mox 的 read 现在没有行号，也会在截断处提示“用 offset=N 接着读”。
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codingTools } from '../../mox/src/tools.ts';
import { runMox, runPi, type RunReport } from '../shared/harness.ts';
import type { Script } from '../shared/scripted.ts';
import { withValidation } from './validated.ts';

const dir = mkdtempSync(join(tmpdir(), 'ch04-validate-'));
writeFileSync(join(dir, 'notes.txt'), Array.from({ length: 8 }, (_, i) => `第 ${i + 1} 行`).join('\n'));
const [read] = codingTools(dir);

const cases: { label: string; script: Script }[] = [
  {
    label: 'A 参数名写错：{ file: "notes.txt", limit: "20" }',
    // 第一次写错，第二次改对；不管看到什么错误，脚本都照这个顺序走，实验比较的是“模型看到的是什么”
    script: (_messages, n) => (n === 1 ? { toolCalls: [{ name: 'read', arguments: { file: 'notes.txt', limit: '20' } }] }
      : n === 2 ? { toolCalls: [{ name: 'read', arguments: { path: 'notes.txt', limit: 2 } }] } : { text: '读到了。' }),
  },
  {
    label: 'B 数字写成字符串：{ path: "notes.txt", offset: "3", limit: "2" }',
    script: (_messages, n) => (n === 1 ? { toolCalls: [{ name: 'read', arguments: { path: 'notes.txt', offset: '3', limit: '2' } }] } : { text: '读到了。' }),
  },
];

const oneLine = (s: string) => s.replace(/\n+/g, ' ⏎ ');
const impls: [string, (c: (typeof cases)[number]) => Promise<RunReport>][] = [
  ['mox 原样', c => runMox({ prompt: '读 notes.txt', script: c.script, tools: [read] })],
  ['mox + withValidation', c => runMox({ prompt: '读 notes.txt', script: c.script, tools: withValidation([read]) })],
  ['Pi', c => runPi({ prompt: '读 notes.txt', script: c.script, tools: [read] })],
];

const seen: Record<string, string> = {};
for (const c of cases) {
  console.log(`## ${c.label}`);
  for (const [label, run] of impls) {
    const report = await run(c);
    const first = report.results[0];
    seen[`${c.label[0]} ${label}`] = first.content;
    console.log(`  ${label.padEnd(22)} ${report.requests} 次请求，第一次调用 ${first.isError ? '失败' : '成功'}`);
    console.log(`  ${''.padEnd(22)} 模型看到：${oneLine(first.content).slice(0, 150)}`);
  }
  console.log('');
}

// 证据：mox 原样得到的是工具函数撞出来的异常，和一份悄悄错位的行号；加上校验或交给 Pi，模型拿到的是明确的信息
assert.match(seen['A mox 原样'], /EISDIR/);
assert.match(seen['A mox + withValidation'], /path: 缺少必填参数/);
assert.match(seen['A Pi'], /path: missing/);
assert.equal(seen['B mox 原样'].split('\n').length, 6);                 // limit: "2" 没有生效：读出了 6 行，也没有“还有后文”的提示
assert.match(seen['B mox + withValidation'], /第 3–4 行/);
assert.match(seen['B Pi'], /第 3–4 行/);
