// 第 16 章实验：计划模式装进 mox。/mode plan 进入只读调研，exit_plan_mode 提交计划，用户批准后开始修改。
//   node labs/ch16/mox-plan.ts
// 三个扩展一起工作：计划模式（本章）、权限（第 14 章）、任务清单（本章）。脚本模型、真正的 runLoop 和工具；终端是脚本化的 ask。
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPermissionsMoxExtension } from '../../extensions/permissions/mox.ts';
import { createPlanModeMoxExtension } from '../../extensions/plan-mode/mox.ts';
import { createTodoMoxExtension } from '../../extensions/todo/mox.ts';
import { scripted } from '../shared/scripted.ts';
import { assemble, describe, firstLine } from '../ch14/host.ts';

const plan = '1. 在 src/cli.ts 的命令分支里加上 list\n2. list 读取所有笔记并按时间倒序打印\n3. 运行 node --check src/cli.ts 验证语法';
const edit = { name: 'edit', arguments: { path: 'src/cli.ts', edits: [{ oldText: 'add();', newText: "add();\nelse if (command === 'list') list();" }] } };
const calls = [
  { name: 'read', arguments: { path: 'src/cli.ts' } },
  edit,                                                                  // 计划模式里：被拦下
  { name: 'bash', arguments: { command: 'ls src && wc -l src/cli.ts' } },
  { name: 'exit_plan_mode', arguments: { plan } },
  edit,                                                                  // 批准之后：放行
];

async function run(order: 'plan-first' | 'permissions-first', quiet = false) {
  const cwd = mkdtempSync(join(tmpdir(), 'ch16-plan-'));
  mkdirSync(join(cwd, 'src'));
  writeFileSync(join(cwd, 'src', 'cli.ts'), "if (command === 'add') add();\n");
  const permissions = createPermissionsMoxExtension([]);
  const model = scripted((_m, n) => (n <= calls.length ? { toolCalls: [calls[n - 1]] } : { text: '已按计划加上 list 命令。' }));
  const sources = [createPlanModeMoxExtension(), permissions, createTodoMoxExtension()];
  if (order === 'permissions-first') [sources[0], sources[1]] = [sources[1], sources[0]];
  const host = await assemble({ cwd, model, sources, answers: (q) => (q.startsWith('批准这个计划') ? '批准' : '允许一次') });
  // /mode 会往终端打印当前模式；第二次运行不需要再看一遍
  const write = process.stdout.write;
  if (quiet) process.stdout.write = () => true;
  await host.command('/mode plan');
  process.stdout.write = write;
  await host.run('给 mox 加一个 list 命令');
  return { host, model, cwd };
}

const label = (s: { name: string; args: any }) => (s.name === 'exit_plan_mode' ? 'exit_plan_mode（提交计划）' : describe(s as any));
const ask = (q: string) => q.split('\n')[0].replace(/\{.*$/, '…');

const { host, model, cwd } = await run('plan-first');
console.log('\n━━ 每个工具调用 ━━');
for (const s of host.steps) console.log(`${s.error ? '✗' : '✓'} ${label(s).padEnd(28)} ${s.name === 'exit_plan_mode' ? s.result : firstLine(s.result, 64)}`);
console.log(`\n弹出的对话框：\n${host.questions.map(q => `  ${ask(q.question)} → 「${q.reply}」`).join('\n')}`);

console.log('\n━━ 每次请求发给模型的东西 ━━');
console.log('| 第几次请求 | 系统提示里有计划模式说明 | exit_plan_mode 在工具列表里 |');
console.log('| --- | --- | --- |');
const rows = model.requests.map((r, i) => ({ n: i + 1, prompt: String((r.messages[0] as any).content).includes('<plan-mode>'), tool: r.tools!.some(t => t.name === 'exit_plan_mode') }));
for (const r of rows) console.log(`| ${r.n}${r.n === 5 ? '（批准之后，同一次运行）' : ''} | ${r.prompt ? '有' : '没有'} | ${r.tool ? '在' : '不在'} |`);
await host.run('再给 list 加上 --limit 参数');
const nextPrompt = model.requests.at(-1)!.messages[0] as any;
console.log(`| 下一次提问 | ${String(nextPrompt.content).includes('<plan-mode>') ? '有' : '没有'} | ${model.requests.at(-1)!.tools!.some(t => t.name === 'exit_plan_mode') ? '在' : '不在'} |`);

// 正文的结论：计划模式里的 edit 被拦下且没有弹框；整个过程只弹两个框：批准计划，以及批准之后第一次 edit 的权限确认
assert.deepEqual(host.steps.map(s => `${s.name}:${s.error ? '拒绝' : '通过'}`), ['read:通过', 'edit:拒绝', 'bash:通过', 'exit_plan_mode:通过', 'edit:通过']);
assert.deepEqual(host.questions.map(q => ask(q.question)), ['批准这个计划吗？', '允许执行吗？edit …']);
assert.deepEqual(rows.map(r => r.prompt), [true, true, true, true, true, true], '同一次运行里系统提示不会更新：批准之后的请求里计划模式的说明还在');
assert.ok(rows.every(r => r.tool), 'exit_plan_mode 一直在工具列表里');
assert.ok(!String(nextPrompt.content).includes('<plan-mode>'), '下一次提问时系统提示里没有计划模式的说明了');
assert.equal(readFileSync(join(cwd, 'src', 'cli.ts'), 'utf8'), "if (command === 'add') add();\nelse if (command === 'list') list();\n");

// 加载顺序：每个扩展都会被问到，拒绝优先，所以顺序不影响安全。但权限扩展排在前面时，它会先问用户，计划模式随后还是拒绝：用户被白问了一次
const reversed = await run('permissions-first', true);
const editStep = reversed.host.steps[1];
const asked = reversed.host.questions.findIndex(q => q.question.startsWith('批准'));
console.log(`\n━━ 加载顺序 ━━\n计划模式先加载：计划模式里的 edit 被拒绝（${host.steps[1].error ? '被拦下' : '放过去了'}），批准计划之前用户被问了 ${host.questions.findIndex(q => q.question.startsWith('批准'))} 次。`);
console.log(`权限扩展先加载：用户被问了 ${asked} 次“允许执行吗？edit”，点了“允许”，计划模式照样拒绝：edit ${editStep.error ? '被拦下' : '执行了'}，${asked} 次提问白问了。`);
assert.ok(host.steps[1].error && host.questions[0].question.startsWith('批准'));
assert.ok(reversed.host.questions[0].question.startsWith('允许执行吗？edit'));
assert.equal(asked, 1);
assert.ok(editStep.error && editStep.result.includes('计划模式'), '拒绝优先：权限扩展放行了，计划模式仍然拒绝');
