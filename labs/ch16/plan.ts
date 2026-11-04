// 第 16 章实验：计划模式。/plan 进入只读调研，exit_plan_mode 提交计划，用户批准后切到 acceptEdits 开始修改。
//   node labs/ch16/plan.ts
// 三个扩展一起工作：计划模式（本章）、权限（第 14 章，接收模式切换事件）、任务清单（本章）。
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/compat';
import { createPermissionsExtension } from '../../extensions/permissions/index.ts';
import { createPlanModeExtension } from '../../extensions/plan-mode/index.ts';
import { createTodoExtension } from '../../extensions/todo/index.ts';
import { createPiSession, textOf } from '../shared/pi-session.ts';

const cwd = mkdtempSync(join(tmpdir(), 'ch16-plan-'));
mkdirSync(join(cwd, 'src'));
writeFileSync(join(cwd, 'src', 'cli.ts'), "if (command === 'add') add();\n");
const plan = '1. 在 src/cli.ts 的命令分支里加上 list\n2. list 读取所有笔记并按时间倒序打印\n3. 运行 node --check src/cli.ts 验证语法';
const call = (name: string, args: object, id: string) => fauxAssistantMessage(fauxToolCall(name, args, { id }), { stopReason: 'toolUse' });
const dialogs: string[] = [];
const toolsSeen: string[][] = [];
// 按 Pi 1.5 的方式重放 system 消息里的工具增减，得到这次请求可用的工具
const tools = (c: any) => { const s = new Set<string>(); for (const m of c.messages) if (m.role === 'system') { for (const t of m.toolsRemoved ?? []) s.delete(t.name); for (const t of m.toolsAdded ?? []) s.add(t.name); } return [...s]; };
const record = (step: any) => (c: any) => { toolsSeen.push(tools(c)); return step; };

const { session } = await createPiSession({
  cwd,
  ui: {
    select: async (title: string, options: string[]) => { dialogs.push(title.split('\n')[0]); return options[0]; },
    notify: () => {}, setStatus: () => {},
  },
  extensions: [createPermissionsExtension({ files: () => [] }), createPlanModeExtension(), createTodoExtension()],
  responses: [
    record(call('read', { path: 'src/cli.ts' }, 'r1')),
    record(call('edit', { path: 'src/cli.ts', edits: [{ oldText: 'add();', newText: "add();\nelse if (command === 'list') list();" }] }, 'e0')),
    record(call('bash', { command: 'ls src && wc -l src/cli.ts' }, 'b1')),
    record(call('exit_plan_mode', { plan }, 'p1')),
    record(call('edit', { path: 'src/cli.ts', edits: [{ oldText: 'add();', newText: "add();\nelse if (command === 'list') list();" }] }, 'e1')),
    record(fauxAssistantMessage('已按计划加上 list 命令。')),
  ],
});
await session.prompt('/plan');
await session.prompt('给 mox 加一个 list 命令');
for (const m of session.messages as any[]) {
  if (m.role !== 'toolResult') continue;
  console.log(`${m.isError ? '✗' : '✓'} ${m.toolName}  ${textOf(m).split('\n')[0].slice(0, 90)}`);
}
console.log(`\n弹出的对话框：${dialogs.join('；')}（选择了“批准，并自动接受编辑”）。计划模式中被拒绝的 edit 没有弹框：权限扩展也处在 plan 模式`);
console.log(`批准之后的 edit 没有再弹确认框：权限扩展收到了 permissions:set-mode 事件，切到了 acceptEdits。`);
console.log(`\nexit_plan_mode 在模型工具列表里吗？计划模式中：${toolsSeen[0].includes('exit_plan_mode') ? '在' : '不在'}；批准之后：${toolsSeen.at(-1)!.includes('exit_plan_mode') ? '在' : '不在'}`);
console.log(`\n文件最后的内容：${JSON.stringify(readFileSync(join(cwd, 'src', 'cli.ts'), 'utf8'))}`);
// 正文的结论：计划模式里 edit 被拦下（没弹框），exit_plan_mode 之后 edit 放行（没弹框）；整个过程只弹出批准计划的那一个对话框
const outcome = (session.messages as any[]).filter(m => m.role === 'toolResult').map(m => `${m.toolName}:${m.isError ? '拒绝' : '通过'}`);
assert.deepEqual(outcome, ['read:通过', 'edit:拒绝', 'bash:通过', 'exit_plan_mode:通过', 'edit:通过']);
assert.equal(dialogs.length, 1);
assert.ok(dialogs[0].startsWith('批准这个计划吗'));
assert.ok(toolsSeen[0].includes('exit_plan_mode') && !toolsSeen.at(-1)!.includes('exit_plan_mode'));
assert.equal(readFileSync(join(cwd, 'src', 'cli.ts'), 'utf8'), "if (command === 'add') add();\nelse if (command === 'list') list();\n");
session.dispose();
