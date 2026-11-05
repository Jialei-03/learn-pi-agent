// 第 14 章实验：权限扩展接进真正的 mox 命令行。
//   node labs/ch14/cli-rules.ts
// 命令：mox -e extensions/permissions/mox.ts；规则写在 ~/.mox/permissions.json（这里是临时目录里的 HOME）。
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { callsInOrder, runCli } from './cli-run.ts';

const script = callsInOrder([
  { name: 'bash', arguments: { command: 'npm run build' } },
  { name: 'bash', arguments: { command: 'cat .env' } },
  { name: 'write', arguments: { path: 'util.ts', content: 'export {};\n' } },
  { name: 'bash', arguments: { command: `python3 -c "print(open('.env').read())"` } },
]);
const options = {
  script,
  prompt: '构建，然后看看 .env',
  flags: ['-e', join(process.cwd(), 'extensions/permissions/mox.ts')],
  project: { '.env': 'TOKEN=secret\n', 'package.json': JSON.stringify({ scripts: { build: 'echo built' } }) },
  home: { '.mox/permissions.json': JSON.stringify({ permissions: { deny: ['Read(.env)', 'Bash(rm *)'], allow: ['Bash(npm run *)'] } }) },
};

const show = (title: string, outcomes: { ok: boolean; what: string; result: string }[]) => {
  console.log(`━━ ${title} ━━`);
  for (const o of outcomes) console.log(`${o.ok ? '✓' : '✗'} ${o.what.padEnd(48)} ${o.result.replace(/\s+/g, ' ').replace(/^错误：/, '').slice(0, 56)}`);
  console.log();
};

// 有终端：write 要确认（选 2 = 本会话都允许），python 要确认（选 3 = 拒绝）；规则允许的和禁止的根本不问
const talk = await runCli({ ...options, answers: ['2', '3'] });
show('有终端（两次提问，回答 2、3）', talk.outcomes);
assert.deepEqual(talk.outcomes.map(o => o.ok), [true, false, true, false]);
assert.ok(talk.outcomes[1].result.includes('被规则 Read(.env) 禁止'));
assert.equal(talk.outcomes[3].result, '错误：用户拒绝了这次调用');
assert.ok(talk.exists('util.ts'));

// -p：没有终端，要确认的一律拒绝；deny 和 allow 的规则照常生效
const headless = await runCli(options);
show('-p（没有终端）', headless.outcomes);
assert.deepEqual(headless.outcomes.map(o => o.ok), [true, false, false, false]);
assert.ok(headless.outcomes[2].result.includes('当前没有终端可以确认'));
assert.ok(!headless.exists('util.ts'));
