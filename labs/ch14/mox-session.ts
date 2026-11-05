// 第 14 章实验：规则式权限扩展装进 mox。脚本模型、真正的 runLoop 和工具、真正的扩展；终端是脚本化的 ask。
//   node labs/ch14/mox-session.ts
// 同一组命令走四种情况：有终端、没有终端、计划模式，以及“只能拒绝”的旧接口和现在的“可以放行”对比。
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPermissionsMoxExtension } from '../../extensions/permissions/mox.ts';
import { scripted } from '../shared/scripted.ts';
import type { ExtensionApi } from '../../mox/src/extensions.ts';
import { assemble, describe, firstLine, type Answers } from './host.ts';

function project() {
  const cwd = mkdtempSync(join(tmpdir(), 'ch14-'));
  mkdirSync(join(cwd, 'src'));
  writeFileSync(join(cwd, 'src', 'app.ts'), 'export const port = 3000;\n');
  writeFileSync(join(cwd, '.env'), 'TOKEN=secret\n');
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'demo', scripts: { build: 'echo built' } }));
  writeFileSync(join(cwd, '.gitignore'), '.env\npermissions.json\n');
  writeFileSync(join(cwd, 'permissions.json'), JSON.stringify({ permissions: { deny: ['Read(.env)', 'Bash(rm *)'], allow: ['Bash(npm run *)'] } }));
  execSync('git init -q && git config user.email lab@example.com && git config user.name lab', { cwd });
  return cwd;
}
// 和 labs/ch14/session.ts 里 Pi 的那组调用一一对应（mox 的 edit 参数是 path / old / new）
const calls = [
  { name: 'read', arguments: { path: 'src/app.ts' } },
  { name: 'bash', arguments: { command: 'npm run build' } },
  { name: 'bash', arguments: { command: 'git add -A && git commit -m "wip"' } },
  { name: 'edit', arguments: { path: 'src/app.ts', edits: [{ oldText: '3000', newText: '8080' }] } },
  { name: 'write', arguments: { path: 'src/util.ts', content: 'export {};\n' } },
  { name: 'bash', arguments: { command: 'cat .env' } },
  { name: 'bash', arguments: { command: `python3 -c "print(open('.env').read())"` } },
];
const script = () => scripted((_m, n) => (n <= calls.length ? { toolCalls: [calls[n - 1]] } : { text: '完成。' }));

/** 旧接口：tool_call 只能拒绝，返回 true 没有意义。把扩展的 true 吞掉，就是 mox 4c9a65c 之前的行为 */
const onlyRefuse = (extension: (mox: ExtensionApi) => unknown) => (mox: ExtensionApi) =>
  extension({ ...mox, on: (event, handler) => mox.on(event, async (...args: unknown[]) => { const r = await handler(...args); return r === true ? undefined : r; }) });

async function run(title: string, { answers, mode, old = false }: { answers: Answers; mode?: 'plan'; old?: boolean }) {
  const cwd = project();
  const permissions = createPermissionsMoxExtension([{ path: join(cwd, 'permissions.json'), base: cwd }], mode);
  const host = await assemble({ cwd, model: script(), sources: [old ? onlyRefuse(permissions) : permissions], answers });
  await host.run('把端口改成 8080，加一个 util.ts，提交一下，顺便看看 .env 里配了什么');
  console.log(`━━ ${title} ━━`);
  for (const s of host.steps) console.log(`${s.error ? '✗' : '✓'} ${describe(s)}${s.error ? `\n    ${firstLine(s.result).replace(/^错误：/, '')}` : ''}`);
  if (host.questions.length) {
    console.log('弹出的确认框：');
    for (const q of host.questions) {
      const text = q.question.startsWith('允许执行吗') ? q.question.slice(0, q.question.lastIndexOf('（')) : q.question;
      console.log(`    ${text.length > 64 ? `${text.slice(0, 64)}…` : text} → 「${q.reply}」${q.question.startsWith('允许执行吗') ? '' : '  ← mox 内置的确认'}`);
    }
  }
  console.log();
  return { allowed: host.steps.map(s => !s.error), asked: host.questions.map(q => q.question) };
}

const interactive = await run('有终端：用户逐个确认（mox -e permissions）', { answers: ['允许一次', '本会话都允许', '拒绝'] });
assert.deepEqual(interactive.allowed, [true, true, true, true, true, false, false]);
assert.equal(interactive.asked.length, 3);
['允许执行吗？git add -A && git commit', '允许执行吗？edit', '允许执行吗？python3'].forEach((prefix, i) => assert.ok(interactive.asked[i].startsWith(prefix), `第 ${i + 1} 个确认框应该是 ${prefix}`));

const headless = await run('没有终端（mox -p -e permissions）', { answers: undefined });
assert.deepEqual(headless.allowed, [true, true, false, false, false, false, false]);

const plan = await run('计划模式', { answers: [], mode: 'plan' });
assert.deepEqual(plan.allowed, [true, false, false, false, false, false, false]);

// 旧接口：扩展说 allow 也没用，内置的“允许吗？”照样会问；要少问只能加 --yolo，把内置确认整个关掉
const before = await run('旧接口（只能拒绝）：规则允许的调用，内置确认还会再问一遍', { answers: (_q, choices) => choices[0], old: true });
// 现在的接口：allow 返回 true，跳过内置确认
const after = await run('现在（可以放行）：同样的回答，同样的规则', { answers: (_q, choices) => choices[0] });
const fromExtension = (r: typeof before) => r.asked.filter(q => q.startsWith('允许执行吗？')).length;
console.log(`用户被问了 ${before.asked.length} 次（扩展 ${fromExtension(before)} 次，内置确认 ${before.asked.length - fromExtension(before)} 次）→ ${after.asked.length} 次（扩展 ${fromExtension(after)} 次，内置确认 ${after.asked.length - fromExtension(after)} 次）。`);
assert.ok(before.asked[0].startsWith('允许 bash'), '旧接口：规则允许的 npm run build 仍然触发了内置确认');
assert.deepEqual([fromExtension(before), before.asked.length - fromExtension(before)], [4, 5]);
assert.deepEqual([fromExtension(after), after.asked.length - fromExtension(after)], [4, 0]);
assert.deepEqual(after.allowed, before.allowed, '放行和拒绝的结果完全相同，变的只是被问的次数');
