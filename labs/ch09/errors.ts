// 第 9 章实验：扩展自己抛了异常，mox 命令行会怎样？
//   node labs/ch09/errors.ts
// 一个扩展在某个事件里抛异常，用真正的 mox 命令行（连本地假服务）跑一次 `mox -p`。
// 模型的脚本：先调用一次 read，再回答"好了"。看三种事件下，运行是继续、失败还是崩溃。
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMox } from '../shared/mox-cli.ts';

const root = mkdtempSync(join(tmpdir(), 'ch09-errors-'));
const home = join(root, 'home');
const cwd = join(root, 'project');
mkdirSync(home); mkdirSync(cwd);
writeFileSync(join(cwd, 'README.md'), '# demo\n');

const rows: string[][] = [];
for (const event of ['tool_call', 'agent_end', 'shutdown']) {
  const extension = join(root, `${event}.ts`);
  writeFileSync(extension, `export default mox => mox.on('${event}', () => { throw new Error('扩展的代码有 bug'); });`);
  const { code, output } = await runMox(['-p', '读一下 README', '--yolo', '-e', extension], {
    cwd, home, script: (_request, n) => (n === 1 ? { toolCalls: [{ name: 'read', arguments: { path: 'README.md' } }] } : { text: '好了。' }),
  });
  const tool = output.split('\n').find(l => /^\s+[✓✗]/.test(l))?.trim();
  rows.push([event, tool ?? '', output.includes('好了。') ? '有' : '没有', String(code), output.includes('扩展的代码有 bug') ? '是' : '否']);
  if (event === 'tool_call') assert.match(tool!, /✗ 错误：扩展的代码有 bug/);
  if (event === 'agent_end') assert.equal(code, 1);
  if (event === 'shutdown') assert.match(output, /Error: 扩展的代码有 bug/);
}

console.log('| 抛异常的事件 | read 的结果 | 模型的最终回答 | 命令行退出码 | 异常信息露出来了吗 |');
console.log('| --- | --- | --- | --- | --- |');
for (const row of rows) console.log(`| \`${row[0]}\` | ${row[1].replace(/\|/g, '\\|')} | ${row[2]} | ${row[3]} | ${row[4]} |`);
