// 第 16 章实验：计划模式接进真正的 mox 命令行（借伪终端，像用户那样输入命令、回答提问）。
//   node labs/ch16/cli-plan.ts
// 模型是脚本，命令行、扩展、工具都是真的。
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { callsInOrder, runCli } from '../ch14/cli-run.ts';

const ext = (name: string) => ['-e', join(process.cwd(), `extensions/${name}/mox.ts`)];
const show = (title: string, outcomes: { ok: boolean; what: string; result: string }[]) => {
  console.log(`━━ ${title} ━━`);
  for (const o of outcomes) console.log(`${o.ok ? '✓' : '✗'} ${o.what.slice(0, 30).padEnd(30)} ${o.result.replace(/\s+/g, ' ').replace(/^错误：/, '').slice(0, 60)}`);
  console.log();
};

// 计划模式：/mode plan，然后提任务。第一个回答是批准计划，第二个回答是批准之后第一次 edit 的权限确认
const edit = { name: 'edit', arguments: { path: 'src/cli.ts', edits: [{ oldText: 'add();', newText: "add();\nelse if (command === 'list') list();" }] } };
const plan = await runCli({
  script: callsInOrder([{ name: 'read', arguments: { path: 'src/cli.ts' } }, edit, { name: 'exit_plan_mode', arguments: { plan: '1. 在 src/cli.ts 里加 list 分支' } }, edit]),
  prompt: ['/mode plan', '给 cli 加一个 list 命令'],
  flags: [...ext('plan-mode'), ...ext('permissions')],
  answers: ['1', '1'],
  project: { 'src/cli.ts': "if (command === 'add') add();\n" },
});
show('mox -e plan-mode -e permissions：/mode plan，提任务', plan.outcomes);
assert.deepEqual(plan.outcomes.map(o => o.ok), [true, false, true, true]);
assert.ok(plan.outcomes[1].result.includes('计划模式'));
assert.ok(plan.outcomes[2].result.includes('用户批准了计划'));
assert.ok(plan.requests.at(-1)!.messages[0].content!.includes('<plan-mode>'));

