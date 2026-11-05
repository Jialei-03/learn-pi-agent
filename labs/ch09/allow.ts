// 第 9 章实验：tool_call 返回 true 是什么意思？多个扩展意见不同时听谁的？
//   node labs/ch09/allow.ts
// cli.ts 的权限流程是：先问扩展，再问用户。每个扩展都会被问到：返回字符串 = 拒绝；返回 true = 放行并跳过内置的用户确认；什么都不返回 = 没意见。
// 只要有一个扩展拒绝就拒绝；没人拒绝而有人放行才放行；都没意见才交给内置确认。
// 这里用真正的 mox 命令行（不加 --yolo，没有终端）跑同一条 bash 命令，看不同的扩展组合下它能不能执行。
// 没有终端时，内置确认的结果是"已拒绝"，所以能不能执行完全取决于扩展有没有给出结论。
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMox } from '../shared/mox-cli.ts';

const root = mkdtempSync(join(tmpdir(), 'ch09-allow-'));
const home = join(root, 'home');
const cwd = join(root, 'project');
mkdirSync(home); mkdirSync(cwd);

// #region extensions
// 规则式权限扩展：echo 开头的命令直接放行，其他的没意见
writeFileSync(join(root, 'allow-echo.ts'), `export default mox => mox.on('tool_call', (name, args) => (name === 'bash' && /^echo /.test(args.command) ? true : undefined));`);
// 一个更严格的扩展：所有 bash 都拒绝
writeFileSync(join(root, 'deny-all.ts'), `export default mox => mox.on('tool_call', name => (name === 'bash' ? '这个项目不允许执行命令' : undefined));`);
// #endregion

async function run(command: string, extensions: string[]) {
  const { output } = await runMox(['-p', '执行一条命令', ...extensions.flatMap(e => ['-e', join(root, e)])], {
    cwd, home, script: (_request, n) => (n === 1 ? { toolCalls: [{ name: 'bash', arguments: { command } }] } : { text: '好。' }),
  });
  return output.split('\n').find(l => /^\s+[✓✗]/.test(l))!.trim().replace(/\s+/g, ' ');
}

const cases: [string, string, string[]][] = [
  ['没有扩展', 'echo hi', []],
  ['allow-echo', 'echo hi', ['allow-echo.ts']],
  ['allow-echo', 'ls', ['allow-echo.ts']],
  ['先 allow-echo，再 deny-all', 'echo hi', ['allow-echo.ts', 'deny-all.ts']],
  ['先 deny-all，再 allow-echo', 'echo hi', ['deny-all.ts', 'allow-echo.ts']],
];
const results = [];
for (const [label, command, extensions] of cases) results.push(await run(command, extensions));

console.log('| 加载的扩展（按顺序） | 模型要执行的命令 | 结果 |');
console.log('| --- | --- | --- |');
cases.forEach(([label, command], i) => console.log(`| ${label} | \`${command}\` | ${results[i]} |`));

assert.match(results[0], /✗ 错误：没有终端可以确认/);
assert.match(results[1], /✓ hi/);
assert.match(results[2], /✗ 错误：没有终端可以确认/);       // allow-echo 对 ls 没意见，交给内置确认
assert.match(results[3], /✗ 错误：这个项目不允许执行命令/);       // allow-echo 先放行，但 deny-all 照样被问到，拒绝优先
assert.match(results[4], /✗ 错误：这个项目不允许执行命令/);       // 顺序反过来，结果一样：安全不取决于加载顺序
